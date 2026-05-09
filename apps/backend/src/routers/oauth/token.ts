import express from "express";
import { OAuthClient } from "@repo/zod-types";

import logger from "@/utils/logger";

import { oauthRepository } from "../../db/repositories";
import {
  generateSecureAccessToken,
  generateSecureRefreshToken,
  rateLimitToken,
} from "./utils";

const tokenRouter = express.Router();

type ClientAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      body: {
        error: string;
        error_description: string;
      };
    };

function authenticateClient(
  req: express.Request,
  clientData: OAuthClient,
): ClientAuthResult {
  if (clientData.token_endpoint_auth_method === "client_secret_basic") {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "Client authentication required via Basic auth",
        },
      };
    }

    const credentials = Buffer.from(
      authHeader.substring(6),
      "base64",
    ).toString();
    const [authClientId, authClientSecret] = credentials.split(":");

    if (
      authClientId !== clientData.client_id ||
      authClientSecret !== clientData.client_secret
    ) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "Invalid client credentials",
        },
      };
    }
  } else if (clientData.token_endpoint_auth_method === "client_secret_post") {
    const { client_secret } = req.body;
    if (!client_secret || client_secret !== clientData.client_secret) {
      return {
        ok: false,
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "Invalid client secret",
        },
      };
    }
  }

  return { ok: true };
}

/**
 * OAuth 2.0 Token Endpoint
 * Handles token exchange requests from MCP clients
 * Implements proper PKCE verification and code validation
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

    const ACCESS_TTL = parseInt(process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? "3600", 10);
    const REFRESH_TTL = parseInt(process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS ?? "2592000", 10);
    const { grant_type, code, redirect_uri, client_id, code_verifier } =
      req.body;

    switch (grant_type) {
      case "authorization_code": {
        if (!code) {
          return res.status(400).json({
            error: "invalid_request",
            error_description: "Missing authorization code",
          });
        }

        const codeData = await oauthRepository.getAuthCode(code);
        if (!codeData) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
          });
        }

        if (Date.now() > codeData.expires_at.getTime()) {
          await oauthRepository.deleteAuthCode(code);
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "Authorization code has expired",
          });
        }

        if (codeData.client_id !== client_id) {
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

        const clientData = await oauthRepository.getClient(client_id);
        if (!clientData) {
          return res.status(400).json({
            error: "invalid_client",
            error_description: "Client not found or not registered",
          });
        }

        const auth = authenticateClient(req, clientData);
        if (!auth.ok) {
          return res.status(auth.status).json(auth.body);
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

        if (codeData.code_challenge_method === "S256") {
          const hash = crypto
            .createHash("sha256")
            .update(code_verifier)
            .digest();
          challengeFromVerifier = hash.toString("base64url");
        } else if (codeData.code_challenge_method === "plain") {
          challengeFromVerifier = code_verifier;
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

        // Generate access token
        const accessToken = generateSecureAccessToken();
        await oauthRepository.setAccessToken(accessToken, {
          client_id: codeData.client_id,
          user_id: codeData.user_id,
          scope: codeData.scope,
          expires_at: Date.now() + ACCESS_TTL * 1000,
        });

        const refreshToken = generateSecureRefreshToken();
        await oauthRepository.setRefreshToken(refreshToken, {
          client_id: codeData.client_id,
          user_id: codeData.user_id,
          scope: codeData.scope,
          access_token: accessToken,
          expires_at: Date.now() + REFRESH_TTL * 1000,
        });

        return res.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: "Bearer",
          expires_in: ACCESS_TTL,
          scope: codeData.scope,
        });
      }
      case "refresh_token": {
        const { refresh_token } = req.body;

        if (!refresh_token) {
          return res.status(400).json({
            error: "invalid_request",
            error_description: "Missing refresh token",
          });
        }

        if (!client_id) {
          return res.status(400).json({
            error: "invalid_request",
            error_description: "Missing client_id",
          });
        }

        const rtData = await oauthRepository.getRefreshToken(refresh_token);
        if (!rtData) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "Invalid or expired refresh token",
          });
        }

        if (Date.now() > rtData.expires_at.getTime()) {
          await oauthRepository.deleteRefreshToken(refresh_token);
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "Refresh token expired",
          });
        }

        if (rtData.revoked_at) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "Refresh token revoked",
          });
        }

        if (rtData.client_id !== client_id) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "Client mismatch",
          });
        }

        const clientData = await oauthRepository.getClient(client_id);
        if (!clientData) {
          return res.status(400).json({
            error: "invalid_client",
            error_description: "Client not found or not registered",
          });
        }

        const auth = authenticateClient(req, clientData);
        if (!auth.ok) {
          return res.status(auth.status).json(auth.body);
        }

        // TODO(v1.1): enforce reuse detection per OAuth 2.1 BCP §4.13

        const newAccess = generateSecureAccessToken();
        const newRefresh = generateSecureRefreshToken();

        await oauthRepository.setAccessToken(newAccess, {
          client_id: rtData.client_id,
          user_id: rtData.user_id,
          scope: rtData.scope,
          expires_at: Date.now() + ACCESS_TTL * 1000,
        });
        await oauthRepository.rotateRefreshToken(refresh_token, newRefresh, {
          client_id: rtData.client_id,
          user_id: rtData.user_id,
          scope: rtData.scope,
          access_token: newAccess,
          expires_at: Date.now() + REFRESH_TTL * 1000,
        });

        return res.json({
          access_token: newAccess,
          refresh_token: newRefresh,
          token_type: "Bearer",
          expires_in: ACCESS_TTL,
          scope: rtData.scope,
        });
      }
      default:
        return res.status(400).json({
          error: "unsupported_grant_type",
          error_description: "Supported grant types: authorization_code, refresh_token",
        });
    }
  } catch (error) {
    logger.error("Error in OAuth token endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Token Introspection Endpoint
 * Allows clients to introspect access tokens
 */
tokenRouter.post("/oauth/introspect", async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Request body is missing or malformed",
      });
    }

    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing token parameter",
      });
    }

    // Check if token exists and is valid
    const tokenData = await oauthRepository.getAccessToken(token);

    if (!tokenData || !token.startsWith("mcp_token_")) {
      return res.json({
        active: false,
      });
    }

    // Check if token has expired
    if (Date.now() > tokenData.expires_at.getTime()) {
      await oauthRepository.deleteAccessToken(token);
      return res.json({
        active: false,
      });
    }

    // Token is active, return introspection details
    res.json({
      active: true,
      scope: tokenData.scope,
      client_id: "mcp_client", // In production, store and return actual client_id
      token_type: "Bearer",
      exp: Math.floor(tokenData.expires_at.getTime() / 1000),
      iat: Math.floor((tokenData.expires_at.getTime() - 3600 * 1000) / 1000), // Issued 1 hour before expiry
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
 * Allows clients to revoke access tokens
 */
tokenRouter.post("/oauth/revoke", async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Request body is missing or malformed",
      });
    }

    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing token parameter",
      });
    }

    // Revoke the token by removing it from storage
    if (await oauthRepository.getAccessToken(token)) {
      await oauthRepository.deleteAccessToken(token);
    } else {
      // RFC 7009 specifies that the endpoint should return success even if token doesn't exist
    }

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
