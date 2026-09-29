import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";
import { rateLimitMiddleware } from "@/middleware/rate-limit.middleware";
import logger from "@/utils/logger";

import { namespacesRepository } from "../../db/repositories";
import { publicErrorMessage } from "../../lib/errors";
import { serverErrorTracker } from "../../lib/metamcp/server-error-tracker";
import { initializeIdleServers } from "../../lib/startup";

const adminRouter = express.Router();

/**
 * These routes administer the endpoint's servers: endpoint-scoped API keys
 * are only for using its MCP servers.
 */
function rejectEndpointScopedKeys(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if ((req as ApiKeyAuthenticatedRequest).apiKeyScope === "endpoints") {
    res.status(403).json({
      error: "forbidden",
      message:
        "This API key is limited to using MCP servers: it cannot administer the endpoint.",
    });
    return;
  }
  next();
}

/**
 * Servers reachable through the endpoint. These routes only ever act on the
 * endpoint's own namespace: they used to list and reset the servers of every
 * user of the instance.
 */
async function getEndpointServers(req: express.Request) {
  const { namespaceUuid } = req as ApiKeyAuthenticatedRequest;
  const namespace =
    await namespacesRepository.findByUuidWithServers(namespaceUuid);
  return namespace?.servers ?? [];
}

/**
 * POST /metamcp/admin/reset-errors
 *
 * Resets ERROR state for MCP servers without requiring a full backend restart.
 * Optionally targets a specific server by UUID, or resets all if no UUID given.
 *
 * Body: { "serverUuid": "optional-specific-uuid" }
 * Auth: Same API key as MCP endpoints (X-API-Key header)
 */
adminRouter.post(
  "/:endpoint_name/admin/reset-errors",
  lookupEndpoint,
  authenticateApiKey,
  rejectEndpointScopedKeys,
  rateLimitMiddleware,
  // Parsed once the caller is authenticated
  express.json(),
  async (req, res) => {
    try {
      const { serverUuid } = req.body || {};
      const resetResults: string[] = [];
      const servers = await getEndpointServers(req);

      if (serverUuid) {
        // Reset specific server (must belong to this endpoint's namespace)
        const server = servers.find(
          (candidate) => candidate.uuid === serverUuid,
        );
        if (!server) {
          res.status(404).json({
            success: false,
            error: "Server not found in this endpoint's namespace",
          });
          return;
        }
        await serverErrorTracker.resetServerErrorState(server.uuid);
        resetResults.push(server.uuid);
        logger.info(`Admin API: Reset error state for server ${server.uuid}`);
      } else {
        // Reset every server of the namespace that is in ERROR state
        const errorServers = servers.filter((s) => s.error_status === "ERROR");

        for (const server of errorServers) {
          await serverErrorTracker.resetServerErrorState(server.uuid);
          resetResults.push(server.name || server.uuid);
        }

        logger.info(
          `Admin API: Reset ${resetResults.length} servers from ERROR state: ${resetResults.join(", ")}`,
        );
      }

      // Trigger idle server re-initialization to respawn connections
      // Run async — don't block the response
      initializeIdleServers().catch((err) => {
        logger.error("Admin API: Error re-initializing idle servers:", err);
      });

      res.json({
        success: true,
        reset: resetResults.length,
        servers: resetResults,
        message:
          resetResults.length > 0
            ? `Reset ${resetResults.length} server(s). Idle session re-initialization triggered.`
            : "No servers were in ERROR state.",
      });
    } catch (error) {
      logger.error("Admin API: Error resetting server errors:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reset server errors",
        message: publicErrorMessage(error, "Internal server error"),
      });
    }
  },
);

/**
 * GET /metamcp/admin/error-status
 *
 * Returns current error status of the endpoint's servers (for diagnostics).
 */
adminRouter.get(
  "/:endpoint_name/admin/error-status",
  lookupEndpoint,
  authenticateApiKey,
  rejectEndpointScopedKeys,
  rateLimitMiddleware,
  async (req, res) => {
    try {
      const servers = await getEndpointServers(req);
      const serverStatuses = servers.map((s) => ({
        uuid: s.uuid,
        name: s.name,
        error_status: s.error_status,
        attempts: serverErrorTracker.getServerAttempts(s.uuid),
      }));

      const errorCount = serverStatuses.filter(
        (s) => s.error_status === "ERROR",
      ).length;

      res.json({
        timestamp: new Date().toISOString(),
        total: serverStatuses.length,
        errored: errorCount,
        servers: serverStatuses,
      });
    } catch (error) {
      logger.error("Admin API: Error fetching server statuses:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch server statuses",
      });
    }
  },
);

export default adminRouter;
