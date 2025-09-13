import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";

import { metaMcpServerPool } from "../../lib/metamcp/metamcp-server-pool";
import { SessionLifetimeManagerImpl } from "../../lib/session-lifetime-manager";

const sseRouter = express.Router();

// Session lifetime manager for SSE sessions
const sessionManager = new SessionLifetimeManagerImpl<Transport>("SSE");

// Cleanup function for a specific session
const cleanupSession = async (sessionId: string, transport?: Transport) => {
  console.log(`Cleaning up SSE session ${sessionId}`);

  try {
    // Use provided transport or get from session manager
    const sessionTransport = transport || sessionManager.getSession(sessionId);

    if (sessionTransport) {
      console.log(`Closing transport for session ${sessionId}`);
      await sessionTransport.close();
      console.log(`Transport cleaned up for session ${sessionId}`);
    } else {
      console.log(`No transport found for session ${sessionId}`);
    }

    // Remove from session manager
    sessionManager.removeSession(sessionId);

    // Clean up MetaMCP server pool session
    await metaMcpServerPool.cleanupSession(sessionId);

    console.log(`Session ${sessionId} cleanup completed successfully`);
  } catch (error) {
    console.error(`Error during cleanup of session ${sessionId}:`, error);
    // Even if cleanup fails, remove the session from manager to prevent memory leaks
    sessionManager.removeSession(sessionId);
    console.log(`Removed orphaned session ${sessionId} due to cleanup error`);
    throw error;
  }
};

sseRouter.get(
  "/:endpoint_name/sse",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    const authReq = req as ApiKeyAuthenticatedRequest;
    const { namespaceUuid, endpointName } = authReq;

    try {
      console.log(
        `New public endpoint SSE connection request for ${endpointName} -> namespace ${namespaceUuid}`,
      );

      const webAppTransport = new SSEServerTransport(
        `/metamcp/${endpointName}/message`,
        res,
      );
      console.log("Created public endpoint SSE transport");

      const sessionId = webAppTransport.sessionId;

      // Get or create MetaMCP server instance from the pool
      const mcpServerInstance = await metaMcpServerPool.getServer(
        sessionId,
        namespaceUuid,
      );
      if (!mcpServerInstance) {
        throw new Error("Failed to get MetaMCP server instance from pool");
      }

      console.log(
        `Using MetaMCP server instance for public endpoint session ${sessionId}`,
      );

      sessionManager.addSession(sessionId, webAppTransport);

      // Handle cleanup when connection closes
      res.on("close", async () => {
        console.log(
          `Public endpoint SSE connection closed for session ${sessionId}`,
        );
        await cleanupSession(sessionId);
      });

      await mcpServerInstance.server.connect(webAppTransport);
    } catch (error) {
      console.error("Error in public endpoint /sse route:", error);
      res.status(500).json(error);
    }
  },
);

sseRouter.post(
  "/:endpoint_name/message",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    const authReq = req as ApiKeyAuthenticatedRequest;
    const { namespaceUuid, endpointName } = authReq;

    try {
      const sessionId = req.query.sessionId;
      console.log(
        `Received POST message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
      );

      let transport = sessionManager.getSession(
        sessionId as string,
      ) as SSEServerTransport;

      if (!transport) {
        console.log(`Session ${sessionId} not found, creating new SSE session`);

        // Create new SSE transport for the missing session
        const newTransport = new SSEServerTransport(
          `/metamcp/${endpointName}/message`,
          res,
        );

        // Override the sessionId to match the requested one
        (newTransport as SSEServerTransport & { sessionId: string }).sessionId =
          sessionId as string;

        // Get or create MetaMCP server instance from the pool
        const mcpServerInstance = await metaMcpServerPool.getServer(
          sessionId as string,
          namespaceUuid,
        );
        if (!mcpServerInstance) {
          throw new Error("Failed to get MetaMCP server instance from pool");
        }

        console.log(
          `Using MetaMCP server instance for recreated SSE session ${sessionId}`,
        );

        sessionManager.addSession(sessionId as string, newTransport);

        // Handle cleanup when connection closes
        res.on("close", async () => {
          console.log(
            `Public endpoint SSE connection closed for recreated session ${sessionId}`,
          );
          await cleanupSession(sessionId as string);
        });

        await mcpServerInstance.server.connect(newTransport);
        transport = newTransport;
      }

      await transport.handlePostMessage(req, res);
    } catch (error) {
      console.error("Error in public endpoint /message route:", error);
      res.status(500).json(error);
    }
  },
);

// Initialize automatic cleanup timer using session manager
sessionManager.startCleanupTimer(async (sessionId, transport) => {
  await cleanupSession(sessionId, transport);
});

export default sseRouter;
