import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";

import { metaMcpServerPool } from "../../lib/metamcp/metamcp-server-pool";

const sseRouter = express.Router();

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Web app transports by sessionId

// Cleanup function for a specific session
const cleanupSession = async (sessionId: string) => {
  console.log(`Cleaning up SSE session ${sessionId}`);

  try {
    // Clean up transport
    const transport = webAppTransports.get(sessionId);
    if (transport) {
      console.log(`Closing transport for session ${sessionId}`);
      await transport.close();
      webAppTransports.delete(sessionId);
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
    if (webAppTransports.has(sessionId)) {
      webAppTransports.delete(sessionId);
      console.log(
        `Removed orphaned transport for session ${sessionId} due to cleanup error`,
      );
    }
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

      webAppTransports.set(sessionId, webAppTransport);

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
    // const authReq = req as ApiKeyAuthenticatedRequest;
    // const { namespaceUuid, endpointName } = authReq;

    try {
      const sessionId = req.query.sessionId;
      // console.log(
      //   `Received POST message for public endpoint ${endpointName} -> namespace ${namespaceUuid} sessionId ${sessionId}`,
      // );

      const transport = webAppTransports.get(
        sessionId as string,
      ) as SSEServerTransport;
      if (!transport) {
        res.status(404).end("Session not found");
        return;
      }
      await transport.handlePostMessage(req, res);
    } catch (error) {
      console.error("Error in public endpoint /message route:", error);
      res.status(500).json(error);
    }
  },
);

export default sseRouter;
