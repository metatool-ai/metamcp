import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";
import { lookupEndpoint } from "@/middleware/lookup-endpoint-middleware";

import { createServer } from "../../lib/metamcp/metamcp-proxy";

const sseRouter = express.Router();

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Web app transports by sessionId

// Cleanup function for a specific session
const cleanupSession = async (sessionId: string) => {
  console.log(`Cleaning up SSE session ${sessionId}`);

  // Clean up transport
  const transport = webAppTransports.get(sessionId);
  if (transport) {
    webAppTransports.delete(sessionId);
    await transport.close();
  }

  // No need to clean up server pool session - servers are created per session
  console.log(`SSE session ${sessionId} cleaned up`);
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

      // Create MetaMCP server instance directly using metamcp-proxy
      const mcpServerInstance = await createServer(
        namespaceUuid,
        sessionId,
      );
      if (!mcpServerInstance) {
        throw new Error("Failed to create MetaMCP server instance");
      }

      console.log(
        `Created MetaMCP server instance for public endpoint session ${sessionId}`,
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
