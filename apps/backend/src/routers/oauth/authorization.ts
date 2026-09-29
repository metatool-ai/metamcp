import express from "express";

import logger from "@/utils/logger";

import { oauthRepository } from "../../db/repositories";
import {
  type AuthorizationRequest,
  decodeAuthorizationRequest,
  encodeAuthorizationRequest,
  validateAuthorizationRequest,
} from "../../lib/oauth/authorization-request";
import { getBaseUrl, rateLimitAuth } from "./utils";

const authorizationRouter = express.Router();

/**
 * Consent page of the web app for a validated request. The page is behind
 * the login: unauthenticated users sign in first and come back to it.
 */
function consentPageUrl(
  req: express.Request,
  request: AuthorizationRequest,
): string {
  const url = new URL("/authorize", getBaseUrl(req));
  url.searchParams.set("request", encodeAuthorizationRequest(request));
  return url.toString();
}

/**
 * OAuth 2.0 Authorization Endpoint
 * Handles authorization requests from MCP clients
 */
authorizationRouter.get("/oauth/authorize", rateLimitAuth, async (req, res) => {
  try {
    const { response_type, client_id, redirect_uri, code_challenge_method } =
      req.query;

    logger.info("OAuth authorize request:", {
      response_type,
      client_id,
      redirect_uri,
      code_challenge_method,
    });

    // Validate required parameters
    if (response_type !== "code") {
      return res.status(400).json({
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      });
    }

    const validated = await validateAuthorizationRequest(req.query);
    if (!validated.ok) {
      return res.status(400).json({
        error: validated.error,
        error_description: validated.error_description,
        ...(validated.error === "invalid_client"
          ? { registration_endpoint: `${getBaseUrl(req)}/oauth/register` }
          : {}),
      });
    }

    // Never issue a code straight away, even for a signed-in user: the
    // consent page (behind the login) shows who is asking and where the
    // code goes, and issues it only when the user approves.
    res.redirect(consentPageUrl(req, validated.request));
  } catch (error) {
    logger.error("Error in OAuth authorize endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Callback Handler
 * Legacy landing point after the login (now forwarded to the consent page),
 * and development helper for clients whose redirect_uri is this callback.
 */
authorizationRouter.get("/oauth/callback", rateLimitAuth, async (req, res) => {
  try {
    // Check if we have encoded params (from our internal redirect flow)
    const { params } = req.query;

    if (params) {
      // Encoded parameters used to come back here after the login and get a
      // code issued at once. They now always go through the consent page.
      const decoded =
        typeof params === "string" ? decodeAuthorizationRequest(params) : null;
      const validated = decoded
        ? await validateAuthorizationRequest(decoded)
        : null;
      if (!validated?.ok) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Invalid authorization parameters",
        });
      }
      return res.redirect(consentPageUrl(req, validated.request));
    } else {
      // Handle direct callback with individual query parameters
      // This is likely from an external OAuth flow or direct URL access
      const { code, state } = req.query;

      if (!code) {
        return res.status(400).send("Missing authorization code");
      }

      // If we receive a code directly, look up the code data to get the original parameters
      const codeData = await oauthRepository.getAuthCode(code as string);
      if (codeData) {
        // Check if code has expired
        if (Date.now() > codeData.expires_at.getTime()) {
          await oauthRepository.deleteAuthCode(code as string);
          return res.status(400).send("Authorization code has expired");
        }

        // Check if the redirect_uri points back to our own callback endpoint
        // This would create an infinite loop, so we need to handle it differently
        const baseUrl = getBaseUrl(req);
        const ourCallbackUrl = `${baseUrl}/oauth/callback`;

        if (
          codeData.redirect_uri === ourCallbackUrl ||
          codeData.redirect_uri.includes("/oauth/callback")
        ) {
          // This is likely a development/testing scenario where the client redirect_uri
          // points back to our callback. Instead of redirecting, show the code.
          // Plain text (no markup to inject into); it is a live authorization
          // code, so it must not be cached nor leak through the Referer header.
          res.set({
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              "default-src 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          });
          return res.type("text/plain").send(
            [
              "Authorization successful",
              "",
              // Codes and states are URL-safe: encoding changes nothing but
              // guarantees no markup can come out of them
              `Authorization code: ${encodeURIComponent(String(code))}`,
              `State: ${encodeURIComponent(String(state || "none"))}`,
              "",
              "Exchange this code for an access token at the token endpoint:",
              "POST /oauth/token",
              "Content-Type: application/json",
              "",
              JSON.stringify(
                {
                  grant_type: "authorization_code",
                  code: encodeURIComponent(String(code)),
                  client_id: codeData.client_id,
                  redirect_uri: codeData.redirect_uri,
                },
                null,
                2,
              ),
            ].join("\n"),
          );
        }

        // Code exists and is valid, redirect back to the original redirect_uri
        const redirectUrl = new URL(codeData.redirect_uri);
        redirectUrl.searchParams.set("code", code as string);
        if (state) {
          redirectUrl.searchParams.set("state", state as string);
        }
        return res.redirect(redirectUrl.toString());
      } else {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Invalid authorization parameters",
        });
      }
    }
  } catch (error) {
    logger.error("Error in OAuth callback:", error);
    res.status(500).send("OAuth callback error");
  }
});

export default authorizationRouter;
