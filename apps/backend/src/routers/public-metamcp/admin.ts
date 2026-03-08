import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";
import logger from "@/utils/logger";

import { mcpServersRepository } from "../../db/repositories";
import { serverErrorTracker } from "../../lib/metamcp/server-error-tracker";
import { initializeIdleServers } from "../../lib/startup";

const adminRouter = express.Router();

// JSON body parser for admin routes
adminRouter.use(express.json());

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
  async (req: ApiKeyAuthenticatedRequest, res) => {
    try {
      const { serverUuid } = req.body || {};
      const resetResults: string[] = [];

      if (serverUuid) {
        // Reset specific server
        await serverErrorTracker.resetServerErrorState(serverUuid);
        resetResults.push(serverUuid);
        logger.info(
          `Admin API: Reset error state for server ${serverUuid}`,
        );
      } else {
        // Reset all servers in ERROR state
        const allServers = await mcpServersRepository.findAll();
        const errorServers = allServers.filter(
          (s) => s.error_status === "ERROR",
        );

        for (const server of errorServers) {
          await serverErrorTracker.resetServerErrorState(server.uuid);
          resetResults.push(server.name || server.uuid);
        }

        // Also clear all in-memory crash counters
        serverErrorTracker.resetAllAttempts();

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
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

/**
 * GET /metamcp/admin/error-status
 *
 * Returns current error status of all servers (for diagnostics).
 */
adminRouter.get(
  "/:endpoint_name/admin/error-status",
  lookupEndpoint,
  authenticateApiKey,
  async (req: ApiKeyAuthenticatedRequest, res) => {
    try {
      const allServers = await mcpServersRepository.findAll();
      const serverStatuses = allServers.map((s) => ({
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
