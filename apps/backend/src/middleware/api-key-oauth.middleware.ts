import { type ApiKeyScope, DatabaseEndpoint } from "@repo/zod-types";
import express from "express";

import logger from "@/utils/logger";

import { oauthRepository } from "../db/repositories";
import { ApiKeysRepository } from "../db/repositories/api-keys.repo";
import { namespacesRepository } from "../db/repositories/namespaces.repo";
import { accessService } from "../lib/access/access.service";
import { endpointAccessCache } from "../lib/access/endpoint-access-cache";
import {
  authRateLimiter,
  getAuthRateLimitIdentifier,
} from "../lib/auth-rate-limiter";
import { getBaseUrl } from "../routers/oauth/utils";

// Extend Express Request interface for our custom properties
export interface ApiKeyAuthenticatedRequest extends express.Request {
  namespaceUuid: string;
  endpointName: string;
  endpoint: DatabaseEndpoint;
  apiKeyUserId?: string;
  apiKeyUuid?: string;
  /**
   * "endpoints": the key is limited to MCP traffic on some endpoints; it
   * must not reach the admin tools nor the endpoint administration routes.
   */
  apiKeyScope?: ApiKeyScope;
  oauthUserId?: string; // For OAuth-authenticated requests
  authMethod?: "api_key" | "oauth"; // Track which auth method was used
}

const apiKeysRepository = new ApiKeysRepository();

/**
 * Validates a MetaMCP OAuth access token against the token store, in
 * process: going through the public /oauth/introspect URL would make the
 * backend call itself through the proxy chain (or through an address derived
 * from client-controlled forwarding headers when APP_URL is unset).
 */
async function validateOAuthToken(token: string): Promise<{
  valid: boolean;
  user_id?: string;
  scopes?: string[];
  error?: string;
}> {
  if (!token.startsWith("mcp_token_")) {
    return { valid: false, error: "Unsupported token format" };
  }
  try {
    const tokenData = await oauthRepository.getActiveAccessToken(token);
    if (!tokenData) {
      return { valid: false, error: "Token is not active" };
    }
    return {
      valid: true,
      user_id: tokenData.user_id,
      scopes: tokenData.scope ? tokenData.scope.split(" ") : ["admin"],
    };
  } catch (error) {
    logger.error("Error validating OAuth token:", error);
    return { valid: false, error: "OAuth validation failed" };
  }
}

/**
 * Extract authentication token from request headers and query parameters
 */
function extractAuthToken(
  req: express.Request,
  endpoint: DatabaseEndpoint,
): {
  token?: string;
  source: "x-api-key" | "authorization" | "query" | "none";
  isOAuthLikeToken: boolean;
} {
  // Check for API key in X-API-Key header
  const apiKeyHeader = req.headers["x-api-key"] as string;
  if (apiKeyHeader) {
    return {
      token: apiKeyHeader,
      source: "x-api-key",
      isOAuthLikeToken: false,
    };
  }

  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    return {
      token,
      source: "authorization",
      isOAuthLikeToken: token.startsWith("mcp_token_"),
    };
  }

  // Check query parameters for API key (if enabled)
  if (endpoint.enable_api_key_auth && endpoint.use_query_param_auth) {
    const queryApiKey =
      (req.query.api_key as string) || (req.query.apikey as string);
    if (queryApiKey) {
      return {
        token: queryApiKey,
        source: "query",
        isOAuthLikeToken: false,
      };
    }
  }

  return { source: "none", isOAuthLikeToken: false };
}

/**
 * Enhanced authentication middleware organized by 4 clear conditions
 * to prevent infinite retry issues with MCP inspector
 */
export const authenticateApiKey = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const authReq = req as ApiKeyAuthenticatedRequest;
  const endpoint = authReq.endpoint;

  // Extract token information
  const { token, source, isOAuthLikeToken } = extractAuthToken(req, endpoint);

  // ===== CONDITION 1: Both API key and OAuth OFF =====
  if (!endpoint?.enable_api_key_auth && !endpoint?.enable_oauth) {
    return next(); // Pass through without authentication
  }

  // Failed attempts are counted per client address (auth-rate-limiter). A
  // valid credential is always accepted, even from an address over the
  // limit: without a reverse proxy every client may share one address, and
  // refusing early would let anyone lock legitimate users out.
  try {
    // ===== CONDITION 2: API key ON, OAuth OFF =====
    if (endpoint.enable_api_key_auth && !endpoint.enable_oauth) {
      if (!token) {
        // No token provided - request API key
        return sendApiKeyRequiredResponse(res);
      }

      // Validate API key
      const apiKeyResult = await apiKeysRepository.validateApiKey(token);

      if (apiKeyResult?.valid) {
        // API key valid - perform access control and pass
        authReq.apiKeyUserId = apiKeyResult.user_id || undefined;
        authReq.apiKeyUuid = apiKeyResult.key_uuid;
        authReq.apiKeyScope = apiKeyResult.scope;
        authReq.authMethod = "api_key";

        const accessCheckResult = await checkApiKeyAccess(
          apiKeyResult,
          endpoint,
        );
        if (!accessCheckResult.allowed) {
          return res.status(403).json({
            error: "Access denied",
            message: accessCheckResult.message,
            timestamp: new Date().toISOString(),
          });
        }

        return next();
      } else {
        // API key invalid - check rate limiting
        const rateLimitId = getAuthRateLimitIdentifier(req, endpoint);
        authRateLimiter.recordFailedAttempt(rateLimitId);

        if (authRateLimiter.isRateLimited(rateLimitId)) {
          return sendTooManyAttemptsResponse(res);
        }

        return res.status(401).json({
          error: "invalid_api_key",
          error_description: "The provided API key is invalid or expired",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ===== CONDITION 3: API key ON, OAuth ON =====
    if (endpoint.enable_api_key_auth && endpoint.enable_oauth) {
      if (!token) {
        // No token provided - allow OAuth flow
        return sendOAuthChallengeResponse(req, res, endpoint);
      }

      // If token looks like OAuth token or came from Authorization header, try OAuth first
      if (isOAuthLikeToken || source === "authorization") {
        const oauthResult = await validateOAuthToken(token);

        if (oauthResult.valid) {
          // OAuth token valid - perform access control and pass
          authReq.oauthUserId = oauthResult.user_id;
          authReq.authMethod = "oauth";

          const accessCheckResult = await checkOAuthAccess(
            oauthResult,
            endpoint,
          );
          if (!accessCheckResult.allowed) {
            return res.status(403).json({
              error: "access_denied",
              error_description: accessCheckResult.message,
              timestamp: new Date().toISOString(),
            });
          }

          return next();
        }
      }

      // Try API key validation
      const apiKeyResult = await apiKeysRepository.validateApiKey(token);

      if (apiKeyResult?.valid) {
        // API key valid - perform access control and pass
        authReq.apiKeyUserId = apiKeyResult.user_id || undefined;
        authReq.apiKeyUuid = apiKeyResult.key_uuid;
        authReq.apiKeyScope = apiKeyResult.scope;
        authReq.authMethod = "api_key";

        const accessCheckResult = await checkApiKeyAccess(
          apiKeyResult,
          endpoint,
        );
        if (!accessCheckResult.allowed) {
          return res.status(403).json({
            error: "Access denied",
            message: accessCheckResult.message,
            timestamp: new Date().toISOString(),
          });
        }

        return next();
      } else {
        // Both OAuth and API key failed - check rate limiting
        const rateLimitId = getAuthRateLimitIdentifier(req, endpoint);
        authRateLimiter.recordFailedAttempt(rateLimitId);

        if (authRateLimiter.isRateLimited(rateLimitId)) {
          return sendTooManyAttemptsResponse(res);
        }

        return res.status(401).json({
          error: "invalid_credentials",
          error_description:
            "Authentication failed. Invalid credentials provided.",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // ===== CONDITION 4: API key OFF, OAuth ON =====
    if (!endpoint.enable_api_key_auth && endpoint.enable_oauth) {
      if (!token) {
        // No token provided - allow OAuth flow
        return sendOAuthChallengeResponse(req, res, endpoint);
      }

      // Validate OAuth token
      const oauthResult = await validateOAuthToken(token);

      if (oauthResult.valid) {
        // OAuth token valid - perform access control and pass
        authReq.oauthUserId = oauthResult.user_id;
        authReq.authMethod = "oauth";

        const accessCheckResult = await checkOAuthAccess(oauthResult, endpoint);
        if (!accessCheckResult.allowed) {
          return res.status(403).json({
            error: "access_denied",
            error_description: accessCheckResult.message,
            timestamp: new Date().toISOString(),
          });
        }

        return next();
      } else {
        // OAuth token invalid - check rate limiting
        const rateLimitId = getAuthRateLimitIdentifier(req, endpoint);
        authRateLimiter.recordFailedAttempt(rateLimitId);

        if (authRateLimiter.isRateLimited(rateLimitId)) {
          return sendTooManyAttemptsResponse(res);
        }

        return res.status(401).json({
          error: "invalid_token",
          error_description:
            "The provided OAuth token is invalid or has expired.",
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Fallback - should not reach here with the conditions above
    return res.status(500).json({
      error: "Internal server error",
      message: "Invalid authentication configuration",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error in authentication middleware:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "Failed to validate authentication",
      timestamp: new Date().toISOString(),
    });
  }
};

type AccessCheckResult = { allowed: boolean; message?: string };

async function isOrganisationNamespace(
  namespaceUuid: string,
): Promise<boolean> {
  const namespace = await namespacesRepository.findByUuid(namespaceUuid);
  return namespace !== undefined && namespace.user_id === null;
}

/**
 * RBAC check for a caller identified by an API key or OAuth token. Access to
 * an endpoint is the access to its namespace: the namespace owner, anyone the
 * namespace is shared with (directly, via a group or "Everyone") and, for an
 * organisation namespace, administrators. Owning the endpoint itself grants
 * nothing more. Disabled users are always denied. Decisions are cached for a
 * few seconds.
 */
async function checkUserEndpointAccess(
  userId: string,
  endpoint: DatabaseEndpoint,
): Promise<AccessCheckResult> {
  const cacheKey = `user:${userId}:${endpoint.uuid}:${endpoint.namespace_uuid}`;
  const cached = endpointAccessCache.get(cacheKey);
  if (cached !== undefined) {
    return cached
      ? { allowed: true }
      : {
          allowed: false,
          message: "You don't have access to this endpoint's namespace.",
        };
  }

  const principal = await accessService.getPrincipal(userId);
  if (!principal) {
    return { allowed: false, message: "This account is disabled." };
  }

  // Owning the endpoint is not enough: the namespace behind it must still be
  // reachable (a revoked share or group membership must cut the access).
  const namespace = await namespacesRepository.findByUuid(
    endpoint.namespace_uuid,
  );
  const allowed = Boolean(
    namespace &&
    (await accessService.resolveAccessOne(principal, "namespace", namespace)),
  );

  endpointAccessCache.set(cacheKey, allowed);
  return allowed
    ? { allowed: true }
    : {
        allowed: false,
        message: "You don't have access to this endpoint's namespace.",
      };
}

/**
 * Check if API key has access to the endpoint.
 *
 * An endpoint-scoped key only works on its endpoints; a personal one must
 * also still be allowed there by its owner's access, re-checked on every
 * request (shares, groups and roles change). An organisation key (not tied
 * to a user) reaches the namespaces shared with everyone and, when an
 * administrator dedicated it to endpoints, those of organisation namespaces:
 * never the personal namespaces of users.
 */
async function checkApiKeyAccess(
  validation: {
    user_id?: string | null;
    scope?: ApiKeyScope;
    endpoint_uuids?: string[];
  },
  endpoint: DatabaseEndpoint,
): Promise<AccessCheckResult> {
  if (
    validation.scope === "endpoints" &&
    !validation.endpoint_uuids?.includes(endpoint.uuid)
  ) {
    return {
      allowed: false,
      message: "This API key is not valid for this endpoint.",
    };
  }

  if (validation.user_id) {
    return checkUserEndpointAccess(validation.user_id, endpoint);
  }

  const scoped = validation.scope === "endpoints";
  const cacheKey = `org-key:${scoped ? "scoped" : "all"}:${endpoint.namespace_uuid}`;
  let allowed = endpointAccessCache.get(cacheKey);
  if (allowed === undefined) {
    allowed =
      (scoped && (await isOrganisationNamespace(endpoint.namespace_uuid))) ||
      Boolean(
        await accessService.resolveEveryoneAccess(
          "namespace",
          endpoint.namespace_uuid,
        ),
      );
    endpointAccessCache.set(cacheKey, allowed);
  }
  return allowed
    ? { allowed: true }
    : {
        allowed: false,
        message: scoped
          ? "Organisation API keys only reach organisation namespaces and namespaces shared with everyone. Use a personal API key."
          : "Organisation API keys can only access namespaces shared with everyone. Use a personal API key.",
      };
}

/**
 * Check if OAuth token user has access to the endpoint
 */
async function checkOAuthAccess(
  oauthResult: { user_id?: string; scopes?: string[] },
  endpoint: DatabaseEndpoint,
): Promise<AccessCheckResult> {
  // If no user_id in token, deny access
  if (!oauthResult.user_id) {
    return {
      allowed: false,
      message: "OAuth token missing user information",
    };
  }
  return checkUserEndpointAccess(oauthResult.user_id, endpoint);
}

/**
 * Send API key required response (no WWW-Authenticate header to prevent OAuth flow)
 */
function sendApiKeyRequiredResponse(res: express.Response): express.Response {
  return res.status(401).json({
    error: "authentication_required",
    error_description: "Authentication required via API key",
    supported_methods: [
      "X-API-Key header",
      "query parameter (api_key or apikey)",
    ],
    timestamp: new Date().toISOString(),
  });
}

function sendTooManyAttemptsResponse(res: express.Response): express.Response {
  res.set("Retry-After", "60");
  return res.status(429).json({
    error: "too_many_requests",
    error_description:
      "Too many failed authentication attempts. Please try again later.",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send OAuth challenge response with proper WWW-Authenticate header
 */
function sendOAuthChallengeResponse(
  req: express.Request,
  res: express.Response,
  endpoint: DatabaseEndpoint,
): express.Response {
  const baseUrl = getBaseUrl(req);

  // Set WWW-Authenticate header for OAuth flow
  const bearerChallenge = [
    `Bearer realm="MetaMCP"`,
    `scope="admin"`,
    `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
  ].join(", ");

  res.set("WWW-Authenticate", bearerChallenge);

  const authMethods = ["Authorization header (Bearer token)"];

  // Add API key methods if also enabled
  if (endpoint.enable_api_key_auth) {
    authMethods.push("X-API-Key header");
    if (endpoint.use_query_param_auth) {
      authMethods.push("query parameter (api_key or apikey)");
    }
  }

  const errorDescription = endpoint.enable_api_key_auth
    ? "Authentication required via OAuth bearer token or API key"
    : "Authentication required via OAuth bearer token";

  return res.status(401).json({
    error: "authentication_required",
    error_description: errorDescription,
    resource_metadata: `${baseUrl}/.well-known/oauth-protected-resource`,
    supported_methods: authMethods,
    timestamp: new Date().toISOString(),
  });
}
