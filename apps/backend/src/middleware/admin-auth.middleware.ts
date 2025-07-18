import express from "express";

import { ApiKeysRepository } from "../db/repositories";

const apiKeysRepository = new ApiKeysRepository();

export interface AdminAuthenticatedRequest extends express.Request {
  adminApiKey?: {
    uuid: string;
    user_id?: string | null;
    type: string;
  };
}

/**
 * Middleware to authenticate admin API keys
 * Only allows API keys with type "ADMIN"
 */
export const authenticateAdminApiKey = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const authReq = req as AdminAuthenticatedRequest;

  try {
    // Extract API key from Authorization header or query parameter
    const authHeader = req.headers.authorization;
    const queryApiKey = req.query.api_key as string;

    let apiKey: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      apiKey = authHeader.substring(7);
    } else if (queryApiKey) {
      apiKey = queryApiKey;
    }

    if (!apiKey) {
      return res.status(401).json({
        error: "missing_api_key",
        error_description:
          "Admin API key is required. Provide it in Authorization header as 'Bearer YOUR_KEY' or as 'api_key' query parameter.",
        timestamp: new Date().toISOString(),
      });
    }

    // Validate the API key
    const validation = await apiKeysRepository.validateApiKey(apiKey);

    if (!validation.valid) {
      return res.status(401).json({
        error: "invalid_api_key",
        error_description: "The provided API key is invalid or expired",
        timestamp: new Date().toISOString(),
      });
    }

    // Check if the API key is of type ADMIN
    if (validation.type !== "ADMIN") {
      return res.status(403).json({
        error: "insufficient_permissions",
        error_description: "This endpoint requires an ADMIN type API key",
        timestamp: new Date().toISOString(),
      });
    }

    // Attach admin API key info to request
    authReq.adminApiKey = {
      uuid: validation.key_uuid!,
      user_id: validation.user_id,
      type: validation.type,
    };

    next();
  } catch (error) {
    console.error("Error in admin API key authentication:", error);
    return res.status(500).json({
      error: "internal_server_error",
      error_description: "An error occurred while validating the API key",
      timestamp: new Date().toISOString(),
    });
  }
};
