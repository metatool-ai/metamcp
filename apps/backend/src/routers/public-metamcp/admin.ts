import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";
import logger from "@/utils/logger";

import {
  mcpServersRepository,
  namespacesRepository,
} from "../../db/repositories";
import { mcpServerPool } from "../../lib/metamcp/mcp-server-pool";
import { serverErrorTracker } from "../../lib/metamcp/server-error-tracker";
import { convertDbServerToParams } from "../../lib/metamcp/utils";

const adminRouter = express.Router();

// JSON body parser for admin routes
adminRouter.use(express.json());

/**
 * The per-endpoint admin API is scoped to the endpoint it is called on:
 * it only sees and acts on MCP servers mapped into that endpoint's
 * namespace, and it is only available when the endpoint requires
 * authentication (API key and/or OAuth). Without that, anyone who knows an
 * endpoint name could reset or respawn servers.
 */
const requireAuthenticatedEndpoint = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const endpoint = (req as ApiKeyAuthenticatedRequest).endpoint;
  if (!endpoint?.enable_api_key_auth && !endpoint?.enable_oauth) {
    return res.status(403).json({
      success: false,
      error: "forbidden",
      message:
        "The admin API is only available on endpoints with API key or OAuth authentication enabled.",
    });
  }
  next();
};

async function getEndpointNamespaceServers(req: express.Request) {
  const namespaceUuid = (req as ApiKeyAuthenticatedRequest).namespaceUuid;
  if (!namespaceUuid) return [];
  const namespace =
    await namespacesRepository.findByUuidWithServers(namespaceUuid);
  return namespace?.servers ?? [];
}

/**
 * POST /metamcp/:endpoint_name/admin/reset-errors
 *
 * Resets ERROR state for MCP servers of this endpoint's namespace without
 * requiring a full backend restart. Optionally targets a specific server by
 * UUID (which must belong to the namespace), or resets all errored servers
 * in the namespace if no UUID is given.
 *
 * Body: { "serverUuid": "optional-specific-uuid" }
 * Auth: Same API key / OAuth as the endpoint's MCP routes
 */
adminRouter.post(
  "/:endpoint_name/admin/reset-errors",
  lookupEndpoint,
  requireAuthenticatedEndpoint,
  authenticateApiKey,
  async (req, res) => {
    try {
      const { serverUuid } = req.body || {};
      const namespaceUuid = (req as ApiKeyAuthenticatedRequest).namespaceUuid;
      const servers = await getEndpointNamespaceServers(req);

      let targets: typeof servers;
      if (serverUuid) {
        const target = servers.find((s) => s.uuid === serverUuid);
        if (!target) {
          return res.status(404).json({
            success: false,
            error: "server_not_found",
            message:
              "No MCP server with that UUID in this endpoint's namespace",
          });
        }
        targets = [target];
      } else {
        targets = servers.filter((s) => s.error_status === "ERROR");
      }

      const resetResults: string[] = [];
      for (const server of targets) {
        await serverErrorTracker.resetServerErrorState(server.uuid);
        resetResults.push(
          serverUuid ? server.uuid : server.name || server.uuid,
        );
      }

      logger.info(
        `Admin API: Reset ${resetResults.length} server(s) of namespace ${namespaceUuid} from ERROR state: ${resetResults.join(", ")}`,
      );

      // Respawn idle sessions for the reset servers only. Run async — don't
      // block the response.
      for (const server of targets) {
        mcpServersRepository
          .findByUuid(server.uuid)
          .then((dbServer) =>
            dbServer ? convertDbServerToParams(dbServer) : null,
          )
          .then((params) =>
            params
              ? mcpServerPool.invalidateIdleSession(
                  server.uuid,
                  params,
                  namespaceUuid,
                )
              : undefined,
          )
          .catch((err) => {
            logger.error(
              `Admin API: Error re-initializing idle session for server ${server.uuid}:`,
              err,
            );
          });
      }

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
 * GET /metamcp/:endpoint_name/admin/error-status
 *
 * Returns current error status of the servers in this endpoint's namespace
 * (for diagnostics).
 */
adminRouter.get(
  "/:endpoint_name/admin/error-status",
  lookupEndpoint,
  requireAuthenticatedEndpoint,
  authenticateApiKey,
  async (req, res) => {
    try {
      const servers = await getEndpointNamespaceServers(req);
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
