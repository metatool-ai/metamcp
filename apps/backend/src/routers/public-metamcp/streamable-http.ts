import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";
import { rateLimitMiddleware } from "@/middleware/rate-limit.middleware";
import logger from "@/utils/logger";

import {
  bindMcpSession,
  isMcpSessionOwner,
  sessionsOfCaller,
  unbindMcpSession,
} from "../../lib/access/mcp-session-binding";
import { buildAdminToolsOptions } from "../../lib/admin-mcp/build-admin-tools-options";
import { publicErrorMessage } from "../../lib/errors";
import { extractClientHeaders } from "../../lib/metamcp/header-forwarding";
import { MetaMCPHandlerContext } from "../../lib/metamcp/metamcp-middleware/functional-middleware";
import { metaMcpServerPool } from "../../lib/metamcp/metamcp-server-pool";
import {
  nonNegativeIntFromEnv,
  SessionLifetimeManagerImpl,
} from "../../lib/session-lifetime-manager";

const streamableHttpRouter = express.Router();

// Streamable HTTP sessions outlive the requests that use them, and most MCP
// clients never send DELETE when they exit: without an idle timeout and a
// per-client cap, abandoned sessions (and their MetaMCP server instances)
// would pile up for the life of the process.
const SESSION_IDLE_TIMEOUT_MS = nonNegativeIntFromEnv(
  process.env.SESSION_IDLE_TIMEOUT,
  24 * 60 * 60 * 1000,
);
const MAX_SESSIONS_PER_CLIENT = nonNegativeIntFromEnv(
  process.env.MAX_SESSIONS_PER_CLIENT,
  100,
);

// Session lifetime manager for StreamableHTTP sessions
const sessionManager =
  new SessionLifetimeManagerImpl<StreamableHTTPServerTransport>(
    "StreamableHTTP",
    { idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS },
  );

/**
 * Makes room for a new session of the caller when it reached
 * MAX_SESSIONS_PER_CLIENT, by closing its least recently used idle session.
 * False when every session of the caller is busy.
 */
async function reserveSessionSlot(
  req: ApiKeyAuthenticatedRequest,
): Promise<boolean> {
  if (MAX_SESSIONS_PER_CLIENT === 0) return true;
  const owned = sessionsOfCaller(req);
  if (owned.length < MAX_SESSIONS_PER_CLIENT) return true;
  const victim = sessionManager.leastRecentlyUsed(owned);
  if (!victim) return false;
  logger.info(
    `Session cap (${MAX_SESSIONS_PER_CLIENT}) reached for a client of endpoint ${req.endpointName}, closing its least recently used session ${victim}`,
  );
  await cleanupSession(victim).catch((error) => {
    logger.error(`Error closing session ${victim}:`, error);
  });
  return true;
}

function getRequestContext(
  req: ApiKeyAuthenticatedRequest,
): Pick<MetaMCPHandlerContext, "endpointName" | "auth"> {
  return {
    endpointName: req.endpointName,
    auth: {
      method: req.authMethod || "none",
      apiKeyUuid: req.apiKeyUuid,
      apiKeyUserId: req.apiKeyUserId,
      oauthUserId: req.oauthUserId,
    },
  };
}

function normalizeStreamableHttpAcceptHeader(req: express.Request) {
  const acceptHeader = req.headers.accept;
  const acceptsJson =
    typeof acceptHeader === "string" &&
    acceptHeader.includes("application/json");
  const acceptsEventStream =
    typeof acceptHeader === "string" &&
    acceptHeader.includes("text/event-stream");

  // SDK requires both types in Accept to pass validation (returns 406 otherwise).
  if (!acceptsJson || !acceptsEventStream) {
    req.headers.accept = "application/json, text/event-stream";
  }
}

function getSafeHeaders(req: express.Request): Record<string, unknown> {
  const headers = { ...req.headers };
  if (headers.authorization) {
    headers.authorization = "<redacted>";
  }
  if (headers["x-api-key"]) {
    headers["x-api-key"] = "<redacted>";
  }
  if (headers.cookie) {
    headers.cookie = "<redacted>";
  }
  return headers;
}

// Cleanup function for a specific session
const cleanupSession = async (
  sessionId: string,
  transport?: StreamableHTTPServerTransport,
) => {
  logger.info(`Cleaning up StreamableHTTP session ${sessionId}`);

  try {
    // Use provided transport or get from session manager
    const sessionTransport = transport || sessionManager.getSession(sessionId);

    if (sessionTransport) {
      logger.info(`Closing transport for session ${sessionId}`);
      await sessionTransport.close();
      logger.info(`Transport cleaned up for session ${sessionId}`);
    } else {
      logger.info(`No transport found for session ${sessionId}`);
    }

    // Remove from session manager
    sessionManager.removeSession(sessionId);
    unbindMcpSession(sessionId);

    // Clean up MetaMCP server pool session
    await metaMcpServerPool.cleanupSession(sessionId);

    logger.info(`Session ${sessionId} cleanup completed successfully`);
  } catch (error) {
    logger.error(`Error during cleanup of session ${sessionId}:`, error);
    // Even if cleanup fails, remove the session from manager to prevent memory leaks
    sessionManager.removeSession(sessionId);
    unbindMcpSession(sessionId);
    logger.info(`Removed orphaned session ${sessionId} due to cleanup error`);
    throw error;
  }
};

// Health check endpoint to monitor sessions
streamableHttpRouter.get("/health/sessions", (req, res) => {
  const sessionIds = sessionManager.getSessionIds();
  const poolStatus = metaMcpServerPool.getPoolStatus();

  // Unauthenticated: expose counts only, never session ids.
  res.json({
    timestamp: new Date().toISOString(),
    streamableHttpSessions: {
      count: sessionIds.length,
    },
    metaMcpPoolStatus: {
      idle: poolStatus.idle,
      active: poolStatus.active,
    },
    totalActiveSessions: sessionIds.length + poolStatus.active,
  });
});

streamableHttpRouter.get(
  "/:endpoint_name/mcp",
  lookupEndpoint,
  authenticateApiKey,
  rateLimitMiddleware,
  async (req, res) => {
    // const authReq = req as ApiKeyAuthenticatedRequest;
    // const { namespaceUuid, endpointName } = authReq;
    const sessionId = req.headers["mcp-session-id"] as string;

    // logger.info(
    //   `Received GET message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
    // );

    try {
      logger.info(`Looking up existing session: ${sessionId}`);

      const transport = sessionManager.getSession(sessionId);
      if (
        !transport ||
        !isMcpSessionOwner(sessionId, req as ApiKeyAuthenticatedRequest)
      ) {
        logger.info(`Session ${sessionId} not found for this caller`);
        res.status(404).end("Session not found");
        return;
      } else {
        logger.info(`Found session ${sessionId}, handling request`);
        sessionManager.trackRequest(sessionId, res);
        normalizeStreamableHttpAcceptHeader(req);
        await transport.handleRequest(req, res);
      }
    } catch (error) {
      logger.error("Error in public endpoint /mcp route:", error);
      res.status(500).json(error);
    }
  },
);

streamableHttpRouter.post(
  "/:endpoint_name/mcp",
  lookupEndpoint,
  authenticateApiKey,
  rateLimitMiddleware,
  async (req, res) => {
    const authReq = req as ApiKeyAuthenticatedRequest;
    const { namespaceUuid, endpointName } = authReq;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Log authentication information for debugging
    logger.info(`POST /mcp request for endpoint: ${endpointName}`);
    logger.info(`Authentication method: ${authReq.authMethod || "none"}`);
    logger.info(`Session ID: ${sessionId || "new session"}`);
    logger.info("StreamableHTTP request headers:", getSafeHeaders(req));

    res.on("finish", () => {
      logger.info(
        `StreamableHTTP response finished with status ${res.statusCode}`,
      );
      logger.info("StreamableHTTP response headers:", res.getHeaders());
    });

    if (!sessionId) {
      try {
        logger.info(
          `New public endpoint StreamableHttp connection request for ${endpointName} -> namespace ${namespaceUuid}`,
        );

        if (!(await reserveSessionSlot(authReq))) {
          res.status(429).json({
            error: "too_many_sessions",
            message:
              "Too many open MCP sessions for this client. Close unused sessions (DELETE) and retry.",
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Generate session ID upfront
        const newSessionId = randomUUID();
        logger.info(
          `Generated new session ID: ${newSessionId} for endpoint: ${endpointName}`,
        );

        // Extract client request headers for per-server header forwarding,
        // minus the MetaMCP credentials used to authenticate this request
        const clientRequestHeaders = extractClientHeaders(req.headers, {
          withoutCredentials:
            authReq.endpoint.enable_api_key_auth ||
            authReq.endpoint.enable_oauth,
        });

        const adminTools = await buildAdminToolsOptions(
          authReq.endpoint,
          authReq,
        );

        // Get or create MetaMCP server instance from the pool
        const mcpServerInstance = await metaMcpServerPool.getServer(
          newSessionId,
          namespaceUuid,
          false,
          clientRequestHeaders,
          adminTools,
          getRequestContext(authReq),
        );
        if (!mcpServerInstance) {
          throw new Error("Failed to get MetaMCP server instance from pool");
        }

        logger.info(
          `Using MetaMCP server instance for public endpoint session ${newSessionId} (endpoint: ${endpointName})`,
        );

        // Create transport with the predetermined session ID
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: async (sessionId) => {
            try {
              logger.info(`Session initialized for sessionId: ${sessionId}`);
            } catch (error) {
              logger.error(
                `Error initializing public endpoint session ${sessionId}:`,
                error,
              );
            }
          },
        });

        // Note: Cleanup is handled explicitly via DELETE requests
        // StreamableHTTP is designed to persist across multiple requests
        logger.info("Created public endpoint StreamableHttp transport");
        logger.info(
          `Session ${newSessionId} will be cleaned up when DELETE request is received`,
        );

        // Store transport reference, bound to this endpoint + caller
        sessionManager.addSession(newSessionId, transport);
        bindMcpSession(newSessionId, authReq);
        sessionManager.trackRequest(newSessionId, res);

        logger.info(
          `Public Endpoint Client <-> Proxy sessionId: ${newSessionId} for endpoint ${endpointName} -> namespace ${namespaceUuid}`,
        );
        logger.info(`Stored transport for sessionId: ${newSessionId}`);
        logger.info(`Current stored sessions:`, sessionManager.getSessionIds());
        logger.info(
          `Total active sessions: ${sessionManager.getSessionCount()}`,
        );

        // Connect the server to the transport before handling the request
        await mcpServerInstance.server.connect(transport);

        // Now handle the request - server is guaranteed to be ready
        normalizeStreamableHttpAcceptHeader(req);
        res.type("application/json");
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error("Error in public endpoint /mcp POST route:", error);

        // Provide more detailed error information
        const errorMessage = publicErrorMessage(error, "Unknown error");
        res.status(500).json({
          error: "Internal server error",
          message: errorMessage,
          endpoint: endpointName,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      // logger.info(
      //   `Received POST message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
      // );
      logger.info(`Looking for sessionId: ${sessionId}`);
      try {
        const transport = sessionManager.getSession(sessionId);
        if (!transport || !isMcpSessionOwner(sessionId, authReq)) {
          logger.error(`Transport not found for sessionId ${sessionId}`);
          res.status(404).json({
            error: "Session not found",
            message: `Transport not found for sessionId ${sessionId}`,
            timestamp: new Date().toISOString(),
          });
        } else {
          logger.info(`Found session ${sessionId}, handling request`);
          sessionManager.trackRequest(sessionId, res);
          normalizeStreamableHttpAcceptHeader(req);
          res.type("application/json");
          await transport.handleRequest(req, res);
        }
      } catch (error) {
        logger.error("Error in public endpoint /mcp route:", error);

        const errorMessage = publicErrorMessage(error, "Unknown error");
        res.status(500).json({
          error: "Internal server error",
          message: errorMessage,
          session_id: sessionId,
          endpoint: endpointName,
          timestamp: new Date().toISOString(),
        });
      }
    }
  },
);

streamableHttpRouter.delete(
  "/:endpoint_name/mcp",
  lookupEndpoint,
  authenticateApiKey,
  rateLimitMiddleware,
  async (req, res) => {
    const authReq = req as ApiKeyAuthenticatedRequest;
    const { namespaceUuid, endpointName } = authReq;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    logger.info(
      `Received DELETE message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
    );

    if (sessionId) {
      if (!isMcpSessionOwner(sessionId, authReq)) {
        res.status(404).json({
          error: "Session not found",
          message: `Transport not found for sessionId ${sessionId}`,
        });
        return;
      }
      try {
        logger.info(`Starting cleanup for session ${sessionId}`);

        await cleanupSession(sessionId);

        logger.info(
          `Public endpoint session ${sessionId} cleaned up successfully`,
        );

        res.status(200).json({
          message: "Session cleaned up successfully",
          sessionId: sessionId,
        });
      } catch (error) {
        logger.error("Error in public endpoint /mcp DELETE route:", error);
        res.status(500).json({
          error: "Cleanup failed",
          message: publicErrorMessage(error, "Unknown error"),
          sessionId: sessionId,
        });
      }
    } else {
      res.status(400).json({
        error: "Missing sessionId",
        message: "sessionId header is required for cleanup",
      });
    }
  },
);

// Initialize automatic cleanup timer using session manager
sessionManager.startCleanupTimer(async (sessionId, transport) => {
  await cleanupSession(sessionId, transport);
});

export default streamableHttpRouter;
