import express from "express";

import { auth } from "../../auth";
import { oauthRepository } from "../../db/repositories";
import {
  generateSecureAuthCode,
  getBaseUrl,
  type OAuthParams,
  rateLimitAuth,
  validateRedirectUri,
} from "./utils";

const authorizationRouter = express.Router();

/**
 * OAuth 2.0 Authorization Endpoint
 * Handles authorization requests from MCP clients
 */
authorizationRouter.get("/oauth/authorize", rateLimitAuth, async (req, res) => {
  try {
    const {
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query;

    console.log("OAuth authorize request:", {
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge_method,
    });

    // Validate required parameters
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

    // OAuth 2.1 Security: Enforce PKCE for all clients
    if (!code_challenge || !code_challenge_method) {
      return res.status(400).json({
        error: "invalid_request",
        error_description:
          "PKCE parameters (code_challenge and code_challenge_method) are required per OAuth 2.1",
      });
    }

    // Validate PKCE method (OAuth 2.1 recommends S256)
    if (code_challenge_method !== "S256" && code_challenge_method !== "plain") {
      return res.status(400).json({
        error: "invalid_request",
        error_description:
          "Unsupported code_challenge_method. Supported: S256, plain",
      });
    }

    // OAuth 2.1 Security: Validate redirect URI format
    if (!validateRedirectUri(redirect_uri as string)) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Invalid redirect_uri format or insecure scheme",
      });
    }

    // Validate client_id against registered clients
    const clientData = await oauthRepository.getClient(client_id as string);
    const finalClientId = client_id as string; // Track which client_id to use

    if (!clientData) {
      // Client not found - direct them to use dynamic client registration
      const baseUrl = getBaseUrl(req);
      return res.status(400).json({
        error: "invalid_client",
        error_description:
          "Client not registered. Please register your client first.",
        registration_endpoint: `${baseUrl}/oauth/register`,
        documentation:
          "Use the registration endpoint to dynamically register your OAuth client before authorization.",
      });
    } else {
      // Validate redirect_uri against registered redirect_uris for existing clients
      if (!clientData.redirect_uris.includes(redirect_uri as string)) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "redirect_uri is not registered for this client",
        });
      }
    }

    // Store OAuth parameters for later use (using the correct client_id)
    const oauthParams: OAuthParams = {
      client_id: finalClientId,
      redirect_uri: redirect_uri as string,
      scope: scope ? (scope as string) : "admin",
      state: state ? (state as string) : undefined,
      code_challenge: code_challenge ? (code_challenge as string) : undefined,
      code_challenge_method: code_challenge_method
        ? (code_challenge_method as string)
        : undefined,
    };

    console.log(
      `Using client_id: ${finalClientId} (original: ${client_id}) for redirect_uri: ${redirect_uri}`,
    );

    const baseUrl = getBaseUrl(req);

    // Check if user is already authenticated by verifying better-auth session
    if (req.headers.cookie) {
      try {
        // Verify the session using better-auth
        const sessionUrl = new URL("/api/auth/get-session", baseUrl);
        const headers = new Headers();
        headers.set("cookie", req.headers.cookie);

        const sessionRequest = new Request(sessionUrl.toString(), {
          method: "GET",
          headers,
        });

        const sessionResponse = await auth.handler(sessionRequest);

        if (sessionResponse.ok) {
          const sessionData = (await sessionResponse.json()) as {
            user?: { id: string };
          };

          if (sessionData?.user?.id) {
            // User is already authenticated, generate authorization code directly
            const code = generateSecureAuthCode();

            // Store authorization code with associated data
            await oauthRepository.setAuthCode(code, {
              client_id: oauthParams.client_id,
              redirect_uri: oauthParams.redirect_uri,
              scope: oauthParams.scope || "admin",
              user_id: sessionData.user.id,
              code_challenge: oauthParams.code_challenge || null,
              code_challenge_method: oauthParams.code_challenge_method || null,
              expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
            });

            // Redirect back to the MCP client with authorization code
            const redirectUrl = new URL(oauthParams.redirect_uri);
            redirectUrl.searchParams.set("code", code);
            if (oauthParams.state) {
              redirectUrl.searchParams.set("state", oauthParams.state);
            }

            return res.redirect(redirectUrl.toString());
          }
        }
      } catch (error) {
        console.log("Session verification failed, proceeding to login:", error);
        // Continue to login flow if session verification fails
      }
    }

    // User is not authenticated, redirect to login page
    const authUrl = new URL("/login", baseUrl);
    const encodedParams = Buffer.from(JSON.stringify(oauthParams)).toString(
      "base64url",
    );
    authUrl.searchParams.set(
      "callbackUrl",
      `/oauth/callback?params=${encodedParams}`,
    );

    // Redirect to frontend login page
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error("Error in OAuth authorize endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Callback Handler
 * Handles the callback from frontend login and redirects back to the OAuth client
 * Verifies user authentication before issuing authorization code
 */
authorizationRouter.get("/oauth/callback", async (req, res) => {
  try {
    let oauthParams: OAuthParams;

    // Check if we have encoded params (from our internal redirect flow)
    const { params } = req.query;

    if (params) {
      // Decode OAuth parameters from our internal flow
      oauthParams = JSON.parse(
        Buffer.from(params as string, "base64url").toString(),
      );
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
          // points back to our callback. Instead of redirecting, show a success page.

          return res.send(`
            <html>
              <head><title>OAuth Authorization Successful</title></head>
              <body>
                <h1>Authorization Successful</h1>
                <p>Authorization code: <code>${code}</code></p>
                <p>State: <code>${state || "none"}</code></p>
                <p>You can now exchange this code for an access token using the token endpoint.</p>
                <pre>
POST ${baseUrl}/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "${code}",
  "client_id": "${codeData.client_id}",
  "redirect_uri": "${codeData.redirect_uri}"
}
                </pre>
              </body>
            </html>
          `);
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

    const { client_id, redirect_uri, state } = oauthParams;

    // Verify user authentication by checking session cookies
    if (!req.headers.cookie) {
      // Redirect back to login if no authentication
      const baseUrl = getBaseUrl(req);
      const loginUrl = new URL("/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", req.originalUrl);
      return res.redirect(loginUrl.toString());
    }

    // Verify the session using better-auth
    const sessionUrl = new URL("/api/auth/get-session", getBaseUrl(req));
    const headers = new Headers();
    headers.set("cookie", req.headers.cookie);

    const sessionRequest = new Request(sessionUrl.toString(), {
      method: "GET",
      headers,
    });

    const sessionResponse = await auth.handler(sessionRequest);

    if (!sessionResponse.ok) {
      // Redirect back to login if session invalid
      const baseUrl = getBaseUrl(req);
      const loginUrl = new URL("/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", req.originalUrl);
      return res.redirect(loginUrl.toString());
    }

    const sessionData = (await sessionResponse.json()) as {
      user?: { id: string };
    };

    if (!sessionData?.user?.id) {
      // Redirect back to login if no user
      const baseUrl = getBaseUrl(req);
      const loginUrl = new URL("/login", baseUrl);
      loginUrl.searchParams.set("callbackUrl", req.originalUrl);
      return res.redirect(loginUrl.toString());
    }

    // User is authenticated, generate authorization code
    const code = generateSecureAuthCode();

    // Store authorization code with associated data
    await oauthRepository.setAuthCode(code, {
      client_id,
      redirect_uri,
      scope: oauthParams.scope || "admin",
      user_id: sessionData.user.id,
      code_challenge: oauthParams.code_challenge || null,
      code_challenge_method: oauthParams.code_challenge_method || null,
      expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
    });

    // Redirect back to the MCP client with authorization code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    res.status(500).send("OAuth callback error");
  }
});

export default authorizationRouter;
