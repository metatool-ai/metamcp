import express from "express";

import { endpointsRepository } from "../db/repositories/endpoints.repo";
import { ApiKeyAuthenticatedRequest } from "./api-key-auth.middleware";

// Middleware to lookup endpoint by name and add namespace info to request
export const lookupEndpoint = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const endpointName = req.params.endpoint_name;

  try {
    const endpoint = await endpointsRepository.findByName(endpointName);
    if (!endpoint) {
      return res.status(404).json({
        error: "Endpoint not found",
        message: `No endpoint found with name: ${endpointName}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Add the endpoint info to the request for use in handlers
    const authReq = req as ApiKeyAuthenticatedRequest;
    authReq.namespaceUuid = endpoint.namespace_uuid;
    authReq.endpointName = endpointName;
    authReq.endpoint = endpoint;

    next();
  } catch (error) {
    console.error("Error looking up endpoint:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "Failed to lookup endpoint",
      timestamp: new Date().toISOString(),
    });
  }
};
