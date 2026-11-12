import type { OAuthClient } from "@repo/zod-types";
import express from "express";

import logger from "@/utils/logger";

import { oauthRepository } from "../../db/repositories";
import {
  consentPageCsp,
  type ConsentRequestParams,
  escapeHtml,
  getSessionUserId,
  isSameOriginRequest,
  renderConsentPage,
  signConsentRequest,
  verifyConsentRequest,
} from "./consent";
import {
  generateSecureAuthCode,
  getBaseUrl,
  rateLimitAuth,
  validateRedirectUri,
} from "./utils";

const authorizationRouter = express.Router();

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

type OAuthError = { status: number; error: string; error_description: string };

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Validate the client, its registered redirect_uri and PKCE (S256 only).
 * Used both when rendering consent and again when consent is submitted, so a
 * signed request can never outlive a client deletion or redirect change.
 */
async function validateClientRequest(
  params: Pick<
    ConsentRequestParams,
    "client_id" | "redirect_uri" | "code_challenge" | "code_challenge_method"
  >,
): Promise<{ ok: true; client: OAuthClient } | { ok: false; err: OAuthError }> {
  if (!params.code_challenge || !params.code_challenge_method) {
    return {
      ok: false,
      err: {
        status: 400,
        error: "invalid_request",
        error_description:
          "PKCE parameters (code_challenge and code_challenge_method) are required per OAuth 2.1",
      },
    };
  }

  // OAuth 2.1 / MCP: only S256 is accepted.
  if (params.code_challenge_method !== "S256") {
    return {
      ok: false,
      err: {
        status: 400,
        error: "invalid_request",
        error_description: "Unsupported code_challenge_method. Supported: S256",
      },
    };
  }

  if (!validateRedirectUri(params.redirect_uri)) {
    return {
      ok: false,
      err: {
        status: 400,
        error: "invalid_request",
        error_description: "Invalid redirect_uri format or insecure scheme",
      },
    };
  }

  const client = await oauthRepository.getClient(params.client_id);
  if (!client) {
    return {
      ok: false,
      err: {
        status: 400,
        error: "invalid_client",
        error_description:
          "Client not registered. Please register your client first.",
      },
    };
  }

  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return {
      ok: false,
      err: {
        status: 400,
        error: "invalid_request",
        error_description: "redirect_uri is not registered for this client",
      },
    };
  }

  return { ok: true, client };
}

/** Build the /oauth/authorize URL (relative) for a set of parameters. */
function buildAuthorizePath(params: Partial<ConsentRequestParams>): string {
  const query = new URLSearchParams({ response_type: "code" });
  for (const key of [
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
  ] as const) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) query.set(key, value);
  }
  return `/oauth/authorize?${query.toString()}`;
}

/**
 * OAuth 2.0 Authorization Endpoint
 * Validates the request, then either sends the user to log in (returning
 * here afterwards) or shows a consent page. A code is never issued from a
 * GET; the user must explicitly approve via POST /oauth/authorize/approve.
 */
authorizationRouter.get("/oauth/authorize", rateLimitAuth, async (req, res) => {
  try {
    const response_type = firstString(req.query.response_type);
    const client_id = firstString(req.query.client_id);
    const redirect_uri = firstString(req.query.redirect_uri);
    const scope = firstString(req.query.scope);
    const state = firstString(req.query.state);
    const code_challenge = firstString(req.query.code_challenge);
    const code_challenge_method = firstString(req.query.code_challenge_method);
    const resource = firstString(req.query.resource);

    logger.info("OAuth authorize request:", {
      response_type,
      client_id,
      redirect_uri,
      code_challenge_method,
    });

    if (response_type !== "code") {
      return res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      });
    }

    if (!client_id || !redirect_uri) {
      return res.status(400).json({
        error: "invalid_request",
        error_description:
          "Missing required parameters: client_id or redirect_uri",
      });
    }

    const validation = await validateClientRequest({
      client_id,
      redirect_uri,
      code_challenge: code_challenge ?? "",
      code_challenge_method: code_challenge_method ?? "",
    });
    if (!validation.ok) {
      const { status, ...body } = validation.err;
      if (body.error === "invalid_client") {
        return res.status(status).json({
          ...body,
          registration_endpoint: `${getBaseUrl(req)}/oauth/register`,
          documentation:
            "Use the registration endpoint to dynamically register your OAuth client before authorization.",
        });
      }
      return res.status(status).json(body);
    }

    const params: ConsentRequestParams = {
      client_id,
      redirect_uri,
      scope: scope ?? "admin",
      state,
      code_challenge: code_challenge as string,
      code_challenge_method: code_challenge_method as string,
      resource,
    };

    const userId = await getSessionUserId(req);

    if (!userId) {
      // Not signed in: log in, then come back to this same authorize request
      // (which re-validates everything and shows consent).
      const loginUrl = new URL("/login", getBaseUrl(req));
      loginUrl.searchParams.set("callbackUrl", buildAuthorizePath(params));
      return res.redirect(loginUrl.toString());
    }

    const signedRequest = signConsentRequest(params, userId);
    res.setHeader("Content-Security-Policy", consentPageCsp(redirect_uri));
    res
      .status(200)
      .type("html")
      .send(
        renderConsentPage({
          clientName: validation.client.client_name,
          redirectUri: redirect_uri,
          scope: params.scope,
          signedRequest,
        }),
      );
  } catch (error) {
    logger.error("Error in OAuth authorize endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * Shared handler for consent decisions. Verifies the session, the request
 * origin and the signed consent blob, and re-validates the client before
 * redirecting anywhere.
 */
function consentDecisionHandler(decision: "approve" | "deny") {
  return async (req: express.Request, res: express.Response) => {
    try {
      if (!isSameOriginRequest(req)) {
        return res.status(403).json({
          error: "access_denied",
          error_description: "Cross-origin consent submission rejected",
        });
      }

      const userId = await getSessionUserId(req);
      if (!userId) {
        return res.status(401).json({
          error: "login_required",
          error_description: "You must be signed in to authorize a client",
        });
      }

      const verified = verifyConsentRequest(req.body?.request, userId);
      if (!verified.ok) {
        logger.warn(`Rejected OAuth consent submission: ${verified.reason}`);
        return res.status(400).json({
          error: "invalid_request",
          error_description:
            verified.reason === "expired"
              ? "Consent request has expired. Please start authorization again."
              : "Invalid consent request",
        });
      }

      const params = verified.params;
      const validation = await validateClientRequest(params);
      if (!validation.ok) {
        const { status, ...body } = validation.err;
        return res.status(status).json(body);
      }

      const redirectUrl = new URL(params.redirect_uri);

      if (decision === "deny") {
        redirectUrl.searchParams.set("error", "access_denied");
        if (params.state) redirectUrl.searchParams.set("state", params.state);
        return res.redirect(302, redirectUrl.toString());
      }

      const code = generateSecureAuthCode();
      await oauthRepository.setAuthCode(code, {
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        scope: params.scope || "admin",
        user_id: userId,
        code_challenge: params.code_challenge,
        code_challenge_method: params.code_challenge_method,
        expires_at: Date.now() + AUTH_CODE_TTL_MS,
      });

      redirectUrl.searchParams.set("code", code);
      if (params.state) redirectUrl.searchParams.set("state", params.state);
      return res.redirect(302, redirectUrl.toString());
    } catch (error) {
      logger.error(`Error in OAuth consent (${decision}) endpoint:`, error);
      res.status(500).json({
        error: "server_error",
        error_description: "Internal server error",
      });
    }
  };
}

authorizationRouter.post(
  "/oauth/authorize/approve",
  rateLimitAuth,
  consentDecisionHandler("approve"),
);

authorizationRouter.post(
  "/oauth/authorize/deny",
  rateLimitAuth,
  consentDecisionHandler("deny"),
);

/**
 * Legacy OAuth callback.
 *
 * - `?params=<base64 JSON>`: older login redirects pointed here. The content
 *   is attacker-controllable, so it is never used to mint a code; it is only
 *   turned back into an /oauth/authorize request, which re-validates the
 *   client/redirect/PKCE and requires explicit consent.
 * - `?code=`: development helper for clients whose redirect_uri is this
 *   callback. All reflected values are HTML-escaped.
 */
authorizationRouter.get("/oauth/callback", async (req, res) => {
  try {
    const params = firstString(req.query.params);

    if (params) {
      let decoded: Record<string, unknown>;
      try {
        decoded = JSON.parse(Buffer.from(params, "base64url").toString());
      } catch {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Invalid authorization parameters",
        });
      }
      if (!decoded || typeof decoded !== "object") {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Invalid authorization parameters",
        });
      }
      return res.redirect(
        buildAuthorizePath({
          client_id: firstString(decoded.client_id),
          redirect_uri: firstString(decoded.redirect_uri),
          scope: firstString(decoded.scope),
          state: firstString(decoded.state),
          code_challenge: firstString(decoded.code_challenge),
          code_challenge_method: firstString(decoded.code_challenge_method),
          resource: firstString(decoded.resource),
        }),
      );
    }

    const code = firstString(req.query.code);
    const state = firstString(req.query.state);

    if (!code) {
      return res.status(400).send("Missing authorization code");
    }

    const codeData = await oauthRepository.getAuthCode(code);
    if (!codeData) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Invalid authorization parameters",
      });
    }

    if (Date.now() > codeData.expires_at.getTime()) {
      await oauthRepository.deleteAuthCode(code);
      return res.status(400).send("Authorization code has expired");
    }

    const baseUrl = getBaseUrl(req);
    const ourCallbackUrl = `${baseUrl}/oauth/callback`;

    if (
      codeData.redirect_uri === ourCallbackUrl ||
      codeData.redirect_uri.includes("/oauth/callback")
    ) {
      // Development/testing: the client's redirect_uri is this callback, so
      // show the code instead of redirecting in a loop.
      const tokenRequest = JSON.stringify(
        {
          grant_type: "authorization_code",
          code,
          client_id: codeData.client_id,
          redirect_uri: codeData.redirect_uri,
        },
        null,
        2,
      );
      return res.type("html").send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>OAuth Authorization Successful</title></head>
  <body>
    <h1>Authorization Successful</h1>
    <p>Authorization code: <code>${escapeHtml(code)}</code></p>
    <p>State: <code>${escapeHtml(state || "none")}</code></p>
    <p>You can now exchange this code for an access token using the token endpoint.</p>
    <pre>
POST ${escapeHtml(baseUrl)}/oauth/token
Content-Type: application/json

${escapeHtml(tokenRequest)}
    </pre>
  </body>
</html>`);
    }

    const redirectUrl = new URL(codeData.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }
    return res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error("Error in OAuth callback:", error);
    res.status(500).send("OAuth callback error");
  }
});

export default authorizationRouter;
