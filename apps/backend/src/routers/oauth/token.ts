import express from "express";

import logger from "@/utils/logger";

import { oauthRepository } from "../../db/repositories";
import { matchesTokenHash } from "../../lib/secrets/token-hash";
import {
  generateSecureAccessToken,
  generateSecureRefreshToken,
  rateLimitToken,
} from "./utils";

const tokenRouter = express.Router();

const ACCESS_TOKEN_EXPIRY = 3600; // 1 hour
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 3600; // 7 days

type ClientAuthFailure = {
  status: 400 | 401;
  error: "invalid_client" | "invalid_request";
  error_description: string;
};

/** Client id and secret of an `Authorization: Basic` header (RFC 6749 §2.3.1). */
function basicCredentials(
  req: express.Request,
): { clientId: string; clientSecret: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.substring(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

/**
 * Identifies the calling client (Basic credentials or `client_id` in the
 * body) and checks its secret when it is a confidential client.
 */
async function authenticateClient(req: express.Request): Promise<
  | {
      ok: true;
      client: NonNullable<
        Awaited<ReturnType<typeof oauthRepository.getClient>>
      >;
    }
  | ({ ok: false } & ClientAuthFailure)
> {
  const basic = basicCredentials(req);
  const bodyClientId =
    typeof req.body?.client_id === "string" ? req.body.client_id : undefined;
  const clientId = basic?.clientId ?? bodyClientId;
  if (!clientId) {
    return {
      ok: false,
      status: 401,
      error: "invalid_client",
      error_description: "Client authentication required",
    };
  }
  if (basic && bodyClientId && bodyClientId !== basic.clientId) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      error_description: "Conflicting client identifiers",
    };
  }
  const client = await oauthRepository.getClient(clientId);
  if (!client) {
    return {
      ok: false,
      status: 401,
      error: "invalid_client",
      error_description: "Client not found or not registered",
    };
  }
  const method = client.token_endpoint_auth_method;
  if (method === "client_secret_basic" || method === "client_secret_post") {
    const secret =
      method === "client_secret_basic"
        ? basic?.clientSecret
        : typeof req.body?.client_secret === "string"
          ? req.body.client_secret
          : undefined;
    // Only the digest of the client secret is stored.
    if (!secret || !matchesTokenHash(secret, client.client_secret)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_client",
        error_description: "Invalid client credentials",
      };
    }
  }
  return { ok: true, client };
}

/**
 * Issue a new access token + refresh token pair and store them.
 */
async function issueTokenPair(clientId: string, userId: string, scope: string) {
  const accessToken = generateSecureAccessToken();
  const refreshToken = generateSecureRefreshToken();

  await oauthRepository.setAccessToken(accessToken, {
    client_id: clientId,
    user_id: userId,
    scope,
    expires_at: Date.now() + ACCESS_TOKEN_EXPIRY * 1000,
    refresh_token: refreshToken,
    refresh_token_expires_at: Date.now() + REFRESH_TOKEN_EXPIRY * 1000,
  });

  return { accessToken, refreshToken };
}

/**
 * OAuth 2.0 Token Endpoint
 * Handles token exchange requests from MCP clients
 * Supports authorization_code and refresh_token grant types
 */
tokenRouter.post("/oauth/token", rateLimitToken, async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      logger.error("Token endpoint: req.body is undefined or invalid", {
        body: req.body,
        bodyType: typeof req.body,
        contentType: req.headers["content-type"],
        method: req.method,
      });
      return res.status(400).json({
        error: "invalid_request",
        error_description:
          "Request body is missing or malformed. Ensure Content-Type is application/json or application/x-www-form-urlencoded",
      });
    }

    const { grant_type } = req.body;

    if (grant_type === "refresh_token") {
      return handleRefreshTokenGrant(req, res);
    }

    if (grant_type === "authorization_code") {
      return handleAuthorizationCodeGrant(req, res);
    }

    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description:
        "Supported grant types: authorization_code, refresh_token",
    });
  } catch (error) {
    logger.error("Error in OAuth token endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * Handle grant_type=authorization_code
 */
async function handleAuthorizationCodeGrant(
  req: express.Request,
  res: express.Response,
) {
  const { code, redirect_uri, code_verifier } = req.body;

  // Validate authorization code
  if (!code) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing authorization code",
    });
  }

  // Look up the authorization code
  const codeData = await oauthRepository.getAuthCode(code);
  if (!codeData) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Invalid or expired authorization code",
    });
  }

  // Check if code has expired (10 minutes)
  if (Date.now() > codeData.expires_at.getTime()) {
    await oauthRepository.deleteAuthCode(code);
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Authorization code has expired",
    });
  }

  // Authenticate the client with its registered method (Basic credentials
  // or client_id in the body), then check the code was issued to it
  const clientAuth = await authenticateClient(req);
  if (!clientAuth.ok) {
    return res.status(clientAuth.status).json({
      error: clientAuth.error,
      error_description: clientAuth.error_description,
    });
  }

  // Validate client_id and redirect_uri match the original request
  if (codeData.client_id !== clientAuth.client.client_id) {
    return res.status(400).json({
      error: "invalid_client",
      error_description: "Client ID does not match",
    });
  }

  if (codeData.redirect_uri !== redirect_uri) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Redirect URI does not match",
    });
  }

  // OAuth 2.1 Security: PKCE is mandatory for all clients
  if (!codeData.code_challenge) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description:
        "Authorization code was not issued with PKCE challenge",
    });
  }

  if (!code_verifier) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "PKCE code verifier is required",
    });
  }

  // Verify code challenge
  const crypto = await import("crypto");
  let challengeFromVerifier: string;

  // Only S256 is accepted ("plain" makes the challenge equal the verifier)
  if (codeData.code_challenge_method === "S256") {
    const hash = crypto.createHash("sha256").update(code_verifier).digest();
    challengeFromVerifier = hash.toString("base64url");
  } else {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Unsupported code challenge method",
    });
  }

  if (challengeFromVerifier !== codeData.code_challenge) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "PKCE verification failed",
    });
  }

  // Code is valid, delete it (authorization codes are single-use)
  await oauthRepository.deleteAuthCode(code);

  // Issue access token + refresh token
  const { accessToken, refreshToken } = await issueTokenPair(
    codeData.client_id,
    codeData.user_id,
    codeData.scope,
  );

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRY,
    refresh_token: refreshToken,
    scope: codeData.scope,
  });
}

/**
 * Handle grant_type=refresh_token
 * Issues a new access token + refresh token pair (token rotation).
 */
async function handleRefreshTokenGrant(
  req: express.Request,
  res: express.Response,
) {
  const { refresh_token, client_id } = req.body;

  if (!refresh_token) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing refresh_token parameter",
    });
  }

  // Look up the token row by refresh_token
  const tokenData = await oauthRepository.getByRefreshToken(refresh_token);
  if (!tokenData) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Invalid refresh token",
    });
  }

  // Check refresh token expiry
  if (
    tokenData.refresh_token_expires_at &&
    Date.now() > tokenData.refresh_token_expires_at.getTime()
  ) {
    await oauthRepository.deleteAccessTokenByHash(tokenData.access_token);
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "Refresh token has expired",
    });
  }

  // Validate client_id matches (if provided)
  if (client_id && tokenData.client_id !== client_id) {
    return res.status(400).json({
      error: "invalid_client",
      error_description: "Client ID does not match",
    });
  }

  // Confidential clients must authenticate to refresh (RFC 6749 §6)
  const tokenClient = await oauthRepository.getClient(tokenData.client_id);
  if (!tokenClient) {
    return res.status(400).json({
      error: "invalid_grant",
      error_description: "The client of this refresh token no longer exists",
    });
  }
  if (tokenClient.token_endpoint_auth_method !== "none") {
    const clientAuth = await authenticateClient(req);
    if (
      !clientAuth.ok ||
      clientAuth.client.client_id !== tokenClient.client_id
    ) {
      return res.status(401).json({
        error: "invalid_client",
        error_description: "Client authentication required",
      });
    }
  }

  // Delete old token row (rotation: old refresh token is single-use)
  await oauthRepository.deleteAccessTokenByHash(tokenData.access_token);

  // Issue new access token + refresh token
  const { accessToken, refreshToken } = await issueTokenPair(
    tokenData.client_id,
    tokenData.user_id,
    tokenData.scope,
  );

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRY,
    refresh_token: refreshToken,
    scope: tokenData.scope,
  });
}

/**
 * OAuth 2.0 Token Introspection Endpoint
 * Allows clients to introspect access tokens
 */
tokenRouter.post("/oauth/introspect", rateLimitToken, async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Request body is missing or malformed",
      });
    }

    const { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing token parameter",
      });
    }

    // RFC 7662 §2.1: the caller must authenticate; it only learns about
    // tokens issued to itself.
    const clientAuth = await authenticateClient(req);
    if (!clientAuth.ok) {
      return res.status(clientAuth.status).json({
        error: clientAuth.error,
        error_description: clientAuth.error_description,
      });
    }

    // Unknown and expired tokens are both simply inactive. An expired access
    // token must not delete its row, which still holds the refresh token.
    const tokenData = await oauthRepository.getActiveAccessToken(token);

    if (!tokenData || tokenData.client_id !== clientAuth.client.client_id) {
      return res.json({
        active: false,
      });
    }

    // Token is active, return introspection details
    res.json({
      active: true,
      scope: tokenData.scope,
      client_id: tokenData.client_id,
      token_type: "Bearer",
      exp: Math.floor(tokenData.expires_at.getTime() / 1000),
      iat: Math.floor(tokenData.created_at.getTime() / 1000),
      sub: tokenData.user_id,
    });
  } catch (error) {
    logger.error("Error in OAuth introspect endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Token Revocation Endpoint
 * Allows clients to revoke access tokens or refresh tokens
 */
tokenRouter.post("/oauth/revoke", rateLimitToken, async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Request body is missing or malformed",
      });
    }

    const { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing token parameter",
      });
    }

    // RFC 7009 §2.1: a client may only revoke its own tokens
    const clientAuth = await authenticateClient(req);
    if (!clientAuth.ok) {
      return res.status(clientAuth.status).json({
        error: clientAuth.error,
        error_description: clientAuth.error_description,
      });
    }

    const tokenData =
      (await oauthRepository.getAccessToken(token)) ??
      (await oauthRepository.getByRefreshToken(token));
    if (tokenData && tokenData.client_id === clientAuth.client.client_id) {
      // Revoking either token of a pair revokes the whole grant
      await oauthRepository.deleteAccessTokenByHash(tokenData.access_token);
    }
    // RFC 7009: unknown tokens are not an error

    // RFC 7009 specifies that revocation endpoint should return 200 OK
    res.status(200).send();
  } catch (error) {
    logger.error("Error in OAuth revoke endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

export default tokenRouter;
