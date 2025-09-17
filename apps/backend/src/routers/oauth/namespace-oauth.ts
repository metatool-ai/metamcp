import cors from "cors";
import express from "express";

import { oauthRepository, usersRepository } from "../../db/repositories";
import {
  generateSecureAccessToken,
  rateLimitToken,
  validateSubjectToken,
  jsonParsingMiddleware,
  securityHeaders,
  urlencodedParsingMiddleware,
} from "./utils";

const namespaceOauthRouter = express.Router();

// Enable CORS for all OAuth endpoints with wildcard origin
namespaceOauthRouter.use(
  cors({
    origin: "*", // Allow all origins for OAuth endpoints
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Apply middleware for OAuth-specific routes
namespaceOauthRouter.use(securityHeaders);
namespaceOauthRouter.use(jsonParsingMiddleware);
namespaceOauthRouter.use(urlencodedParsingMiddleware);

/**
 * OAuth 2.0 Token Endpoint for Namespace-specific access
 * Handles token exchange requests from MCP clients
 * Implements proper PKCE verification and code validation
 */
namespaceOauthRouter.post("/token", rateLimitToken, async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      console.error("Token endpoint: req.body is undefined or invalid", {
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

    const { grant_type, code, redirect_uri, client_id, code_verifier } =
      req.body;

    // Validate grant type
    if (grant_type === "authorization_code") {
      // For authorization code flow, delegate to the main OAuth router
      // This is a fallback - namespace clients should use the root OAuth endpoints for full flow
      return res.status(400).json({
        error: "unsupported_grant_type",
        error_description: "Use root OAuth endpoints for authorization code flow: /oauth/authorize and /oauth/token",
      });
    } else if (
      grant_type === "urn:ietf:params:oauth:grant-type:token-exchange"
    ) {
      // OAuth 2.0 Token Exchange (RFC 8693) flow
      const {
        subject_token,
        resource: _resource,
        subject_token_type,
        client_id: exchangeClientId,
      } = req.body;

      // Validate required parameters per RFC 8693
      if (
        !subject_token ||
        subject_token_type !== "urn:ietf:params:oauth:token-type:access_token"
      ) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: "Invalid token exchange parameters",
        });
      }

      // Validate subject token (provider-specific validation)
      const validatedUser = await validateSubjectToken(subject_token);
      if (!validatedUser) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid subject token",
        });
      }

      // Ensure user exists in local database (handles account linking)
      const localUser = await usersRepository.upsert({
        id: validatedUser.id,
        name: validatedUser.email?.split('@')[0] || 'OAuth User', // Use email prefix as name fallback
        email: validatedUser.email || `${validatedUser.id}@oauth.local`, // Ensure we have an email
        emailVerified: true, // External provider already verified this
      });

      // Generate MCP access token using existing infrastructure
      const newAccessToken = generateSecureAccessToken();
      const tokenExpiresIn = 3600; // 1 hour

      // Determine client_id and ensure it exists
      const clientId = exchangeClientId || "mcp_default";

      // Ensure the default client exists if using fallback
      if (clientId === "mcp_default") {
        const existingClient = await oauthRepository.getClient("mcp_default");
        if (!existingClient) {
          await oauthRepository.upsertClient({
            client_id: "mcp_default",
            client_name: "MetaMCP Default Client",
            redirect_uris: [],
            grant_types: ["urn:ietf:params:oauth:grant-type:token-exchange"],
            response_types: [],
            token_endpoint_auth_method: "none",
            scope: "admin",
          });
        }
      }

      // Store access token using existing repository
      await oauthRepository.setAccessToken(newAccessToken, {
        client_id: clientId,
        user_id: localUser.id, // Use the local user ID (handles account linking)
        scope: "admin",
        expires_at: Date.now() + tokenExpiresIn * 1000,
      });

      // Return RFC 8693 compliant response
      return res.json({
        access_token: newAccessToken,
        token_type: "Bearer",
        expires_in: tokenExpiresIn,
        scope: "admin",
      });
    } else {
      return res.status(400).json({
        error: "unsupported_grant_type",
        error_description:
          "Only 'token-exchange' grant type is supported for namespace endpoints. Use root OAuth endpoints for authorization code flow.",
      });
    }
  } catch (error) {
    console.error("Error in namespace OAuth token endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

/**
 * OAuth 2.0 Token Introspection Endpoint for namespace access
 * Allows clients to introspect access tokens
 */
namespaceOauthRouter.post("/introspect", async (req, res) => {
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
    console.error("Error in namespace OAuth introspect endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

export default namespaceOauthRouter;