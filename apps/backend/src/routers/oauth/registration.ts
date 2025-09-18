import express from "express";

import { oauthRepository } from "../../db/repositories";
import {
  generateSecureClientId,
  generateSecureClientSecret,
  rateLimitToken,
  validateRedirectUri,
} from "./utils";

const registrationRouter = express.Router();

/**
 * OAuth 2.0 Dynamic Client Registration Endpoint
 * Allows clients to dynamically register with the authorization server
 * Implementation follows RFC 7591 with OAuth 2.1 security enhancements
 */
registrationRouter.post("/oauth/register", rateLimitToken, async (req, res) => {
  try {
    // Check if body was parsed correctly
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Request body is missing or malformed",
      });
    }

    const {
      redirect_uris,
      response_types,
      grant_types,
      client_name,
      client_uri,
      logo_uri,
      scope,
      contacts,
      tos_uri,
      policy_uri,
      token_endpoint_auth_method,
      software_id,
      software_version,
    } = req.body;

    // Validate required parameters
    if (
      !redirect_uris ||
      !Array.isArray(redirect_uris) ||
      redirect_uris.length === 0
    ) {
      return res.status(400).json({
        error: "invalid_redirect_uri",
        error_description:
          "redirect_uris is required and must be a non-empty array",
      });
    }

    // OAuth 2.1 Security: Validate redirect URIs
    for (const uri of redirect_uris) {
      if (!validateRedirectUri(uri)) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: `Invalid redirect URI: ${uri}. Must use secure scheme and valid format.`,
        });
      }
    }

    // OAuth 2.1 Security: Set secure defaults for optional parameters
    const clientGrantTypes =
      grant_types && Array.isArray(grant_types)
        ? grant_types
        : ["authorization_code"]; // Only authorization_code by default

    const clientResponseTypes =
      response_types && Array.isArray(response_types)
        ? response_types
        : ["code"];

    // OAuth 2.1 Security: Default to PKCE (none auth method)
    const clientTokenEndpointAuthMethod = token_endpoint_auth_method || "none";

    // Validate grant types and response types consistency
    const validGrantTypes = [
      "authorization_code",
      "refresh_token",
      "client_credentials",
    ];
    const validResponseTypes = ["code"];
    const validAuthMethods = [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ];

    for (const grantType of clientGrantTypes) {
      if (!validGrantTypes.includes(grantType)) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: `Unsupported grant type: ${grantType}`,
        });
      }
    }

    for (const responseType of clientResponseTypes) {
      if (!validResponseTypes.includes(responseType)) {
        return res.status(400).json({
          error: "invalid_request",
          error_description: `Unsupported response type: ${responseType}`,
        });
      }
    }

    if (!validAuthMethods.includes(clientTokenEndpointAuthMethod)) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: `Unsupported token endpoint auth method: ${clientTokenEndpointAuthMethod}`,
      });
    }

    // Generate client credentials
    const clientId = generateSecureClientId();

    // OAuth 2.1 Security: Generate client secret only if auth method requires it
    // Recommend PKCE (none) for public clients per OAuth 2.1
    let clientSecret: string | null = null;
    if (clientTokenEndpointAuthMethod !== "none") {
      clientSecret = generateSecureClientSecret();
    }

    // Create client registration
    const clientRegistration = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || "Unnamed MCP Client",
      redirect_uris: redirect_uris,
      grant_types: clientGrantTypes,
      response_types: clientResponseTypes,
      token_endpoint_auth_method: clientTokenEndpointAuthMethod,
      scope: scope || "admin",
      client_uri: client_uri || null,
      logo_uri: logo_uri || null,
      contacts: contacts && Array.isArray(contacts) ? contacts : null,
      tos_uri: tos_uri || null,
      policy_uri: policy_uri || null,
      software_id: software_id || null,
      software_version: software_version || null,
      created_at: new Date(),
    };

    // Store the client registration
    await oauthRepository.upsertClient(clientRegistration);

    // Prepare response according to RFC 7591 with OAuth 2.1 guidance
    const baseUrl = req.protocol + "://" + req.get("host");
    const response: any = {
      client_id: clientId,
      client_name: clientRegistration.client_name,
      redirect_uris: clientRegistration.redirect_uris,
      grant_types: clientRegistration.grant_types,
      response_types: clientRegistration.response_types,
      token_endpoint_auth_method: clientRegistration.token_endpoint_auth_method,
      scope: clientRegistration.scope,

      // OAuth 2.1 Security Information
      oauth_compliance: "OAuth 2.1",
      pkce_required: true,
      pkce_methods_supported: ["S256"],

      // Endpoint information for the client
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
    };

    // Include client_secret only if one was generated
    if (clientSecret) {
      response.client_secret = clientSecret;
      response.security_note =
        "Store client_secret securely. For public clients, use PKCE instead.";
    } else {
      response.security_note =
        "This client uses PKCE for security. Ensure code_challenge and code_challenge_method are included in authorization requests.";
    }

    // Include optional metadata if provided
    if (client_uri) response.client_uri = client_uri;
    if (logo_uri) response.logo_uri = logo_uri;
    if (contacts) response.contacts = contacts;
    if (tos_uri) response.tos_uri = tos_uri;
    if (policy_uri) response.policy_uri = policy_uri;
    if (software_id) response.software_id = software_id;
    if (software_version) response.software_version = software_version;

    res.status(201).json(response);
  } catch (error) {
    console.error("Error in OAuth registration endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error during client registration",
    });
  }
});

/**
 * OAuth 2.0 Dynamic Client Registration Information Endpoint
 * Provides guidance on how to register OAuth clients
 */
registrationRouter.get("/oauth/register", async (req, res) => {
  try {
    const baseUrl = req.protocol + "://" + req.get("host");

    res.json({
      registration_endpoint: `${baseUrl}/oauth/register`,
      oauth_version: "OAuth 2.1",
      description: "Dynamic Client Registration for MetaMCP OAuth Server",

      required_parameters: {
        redirect_uris:
          "Array of redirect URIs for your application (HTTPS required in production)",
      },

      optional_parameters: {
        client_name: "Human-readable name for your application",
        grant_types: "OAuth grant types (default: ['authorization_code'])",
        response_types: "OAuth response types (default: ['code'])",
        token_endpoint_auth_method:
          "Client authentication method (default: 'none' for PKCE)",
        scope: "Requested scope (default: 'admin')",
        client_uri: "Homepage URL for your application",
        logo_uri: "Logo URL for your application",
        contacts: "Array of contact email addresses",
        tos_uri: "Terms of service URL",
        policy_uri: "Privacy policy URL",
      },

      security_recommendations: {
        use_pkce: "Always use PKCE (token_endpoint_auth_method: 'none')",
        https_only: "Use HTTPS redirect URIs in production",
        secure_storage:
          "Store client credentials securely if using client authentication",
        code_challenge_method: "Use 'S256' for code_challenge_method",
      },

      example_registration: {
        method: "POST",
        url: `${baseUrl}/oauth/register`,
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          client_name: "My MCP Application",
          redirect_uris: ["https://myapp.example.com/oauth/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "admin",
        },
      },

      next_steps: [
        "Register your client using POST to this endpoint",
        "Save the returned client_id",
        "Use PKCE in your authorization requests",
        "Include code_challenge and code_challenge_method=S256",
        "Exchange authorization codes for access tokens",
      ],
    });
  } catch (error) {
    console.error("Error in OAuth registration info endpoint:", error);
    res.status(500).json({
      error: "server_error",
      error_description: "Internal server error",
    });
  }
});

export default registrationRouter;
