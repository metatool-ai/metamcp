import cors from "cors";
import express from "express";
import helmet from "helmet";

import {
  INSPECTOR_REQUEST_HEADER,
  requireInspectorRequest,
} from "../middleware/inspector-request.middleware";
import metamcpRoutes from "./mcp-proxy/metamcp";
import serverRoutes from "./mcp-proxy/server";

const mcpProxyRouter = express.Router();

// Apply security middleware for MCP proxy communication
mcpProxyRouter.use(helmet());
mcpProxyRouter.use(
  cors({
    origin: process.env.APP_URL,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "x-custom-auth-header",
      "last-event-id",
      INSPECTOR_REQUEST_HEADER,
    ],
    exposedHeaders: ["mcp-session-id", "last-event-id"],
  }),
);

// Only the MetaMCP web app may drive the proxy (cross-site request guard)
mcpProxyRouter.use(requireInspectorRequest);

// Mount MCP server proxy routes under /server
mcpProxyRouter.use("/server", serverRoutes);

// Mount MetaMCP routes under /metamcp
mcpProxyRouter.use("/metamcp", metamcpRoutes);

export default mcpProxyRouter;
