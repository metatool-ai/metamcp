import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";

import { metaMcpServerPool } from "../../lib/metamcp/metamcp-server-pool";

const streamableHttpRouter = express.Router();

const transports: Record<string, StreamableHTTPServerTransport> = {}; // Web app transports by sessionId

// Cleanup function for a specific session
const cleanupSession = async (sessionId: string) => {
  console.log(`Cleaning up StreamableHTTP session ${sessionId}`);

  try {
    // Clean up transport
    const transport = transports[sessionId];
    if (transport) {
      console.log(`Closing transport for session ${sessionId}`);
      await transport.close();
      delete transports[sessionId];
      console.log(`Transport cleaned up for session ${sessionId}`);
    } else {
      console.log(`No transport found for session ${sessionId}`);
    }

    // Clean up MetaMCP server pool session
    await metaMcpServerPool.cleanupSession(sessionId);

    console.log(`Session ${sessionId} cleanup completed successfully`);
  } catch (error) {
    console.error(`Error during cleanup of session ${sessionId}:`, error);
    // Even if cleanup fails, remove the transport from our map to prevent memory leaks
    if (transports[sessionId]) {
      delete transports[sessionId];
      console.log(
        `Removed orphaned transport for session ${sessionId} due to cleanup error`,
      );
    }
    throw error;
  }
};

// Health check endpoint to monitor sessions
streamableHttpRouter.get("/health/sessions", (req, res) => {
  const sessionIds = Object.keys(transports);
  const poolStatus = metaMcpServerPool.getPoolStatus();

  res.json({
    timestamp: new Date().toISOString(),
    streamableHttpSessions: {
      count: sessionIds.length,
      sessionIds: sessionIds,
    },
    metaMcpPoolStatus: poolStatus,
    totalActiveSessions: sessionIds.length + poolStatus.active,
  });
});

streamableHttpRouter.get(
  "/:endpoint_name/mcp",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    // const authReq = req as ApiKeyAuthenticatedRequest;
    // const { namespaceUuid, endpointName } = authReq;
    const sessionId = req.headers["mcp-session-id"] as string;

    // console.log(
    //   `Received GET message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
    // );

    try {
      console.log(`Looking up existing session: ${sessionId}`);
      console.log(`Available sessions:`, Object.keys(transports));

      const transport = transports[sessionId];
      if (!transport) {
        console.log(`Session ${sessionId} not found in transports`);
        res.status(404).end("Session not found");
        return;
      } else {
        console.log(`Found session ${sessionId}, handling request`);
        await transport.handleRequest(req, res);
      }
    } catch (error) {
      console.error("Error in public endpoint /mcp route:", error);
      res.status(500).json(error);
    }
  },
);

streamableHttpRouter.post(
  "/:endpoint_name/mcp",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    const authReq = req as ApiKeyAuthenticatedRequest;
    const { namespaceUuid, endpointName } = authReq;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Log authentication information for debugging
    console.log(`POST /mcp request for endpoint: ${endpointName}`);
    console.log(`Authentication method: ${authReq.authMethod || "none"}`);
    console.log(`Session ID: ${sessionId || "new session"}`);

    if (!sessionId) {
      try {
        console.log(
          `New public endpoint StreamableHttp connection request for ${endpointName} -> namespace ${namespaceUuid}`,
        );

        // Generate session ID upfront
        const newSessionId = randomUUID();
        console.log(
          `Generated new session ID: ${newSessionId} for endpoint: ${endpointName}`,
        );

        // Get or create MetaMCP server instance from the pool
        const mcpServerInstance = await metaMcpServerPool.getServer(
          newSessionId,
          namespaceUuid,
        );
        if (!mcpServerInstance) {
          throw new Error("Failed to get MetaMCP server instance from pool");
        }

        console.log(
          `Using MetaMCP server instance for public endpoint session ${newSessionId} (endpoint: ${endpointName})`,
        );

        // Create transport with the predetermined session ID
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
          onsessioninitialized: async (sessionId) => {
            try {
              console.log(`Session initialized for sessionId: ${sessionId}`);
            } catch (error) {
              console.error(
                `Error initializing public endpoint session ${sessionId}:`,
                error,
              );
            }
          },
        });

        // Note: Cleanup is handled explicitly via DELETE requests
        // StreamableHTTP is designed to persist across multiple requests
        console.log("Created public endpoint StreamableHttp transport");
        console.log(
          `Session ${newSessionId} will be cleaned up when DELETE request is received`,
        );

        // Store transport reference
        transports[newSessionId] = transport;

        console.log(
          `Public Endpoint Client <-> Proxy sessionId: ${newSessionId} for endpoint ${endpointName} -> namespace ${namespaceUuid}`,
        );
        console.log(`Stored transport for sessionId: ${newSessionId}`);
        console.log(`Current stored sessions:`, Object.keys(transports));
        console.log(`Total active sessions: ${Object.keys(transports).length}`);

        // Connect the server to the transport before handling the request
        await mcpServerInstance.server.connect(transport);

        // Now handle the request - server is guaranteed to be ready
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error in public endpoint /mcp POST route:", error);

        // Provide more detailed error information
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({
          error: "Internal server error",
          message: errorMessage,
          endpoint: endpointName,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      // console.log(
      //   `Received POST message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
      // );
      console.log(`Available session IDs:`, Object.keys(transports));
      console.log(`Looking for sessionId: ${sessionId}`);
      try {
        console.log(`Looking up existing session: ${sessionId}`);
        console.log(`Available sessions:`, Object.keys(transports));

        const transport = transports[sessionId];
        if (!transport) {
          console.error(
            `Transport not found for sessionId ${sessionId}. Available sessions:`,
            Object.keys(transports),
          );
          res.status(404).json({
            error: "Session not found",
            message: `Transport not found for sessionId ${sessionId}`,
            available_sessions: Object.keys(transports),
            timestamp: new Date().toISOString(),
          });
        } else {
          console.log(`Found session ${sessionId}, handling request`);
          await transport.handleRequest(req, res);
        }
      } catch (error) {
        console.error("Error in public endpoint /mcp route:", error);

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
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
  async (req, res) => {
    const authReq = req as ApiKeyAuthenticatedRequest;
    const { namespaceUuid, endpointName } = authReq;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    console.log(
      `Received DELETE message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
    );

    if (sessionId) {
      try {
        console.log(`Starting cleanup for session ${sessionId}`);
        console.log(
          `Available sessions before cleanup:`,
          Object.keys(transports),
        );

        await cleanupSession(sessionId);

        console.log(
          `Public endpoint session ${sessionId} cleaned up successfully`,
        );
        console.log(
          `Available sessions after cleanup:`,
          Object.keys(transports),
        );

        res.status(200).json({
          message: "Session cleaned up successfully",
          sessionId: sessionId,
          remainingSessions: Object.keys(transports),
        });
      } catch (error) {
        console.error("Error in public endpoint /mcp DELETE route:", error);
        res.status(500).json({
          error: "Cleanup failed",
          message: error instanceof Error ? error.message : "Unknown error",
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

export default streamableHttpRouter;
