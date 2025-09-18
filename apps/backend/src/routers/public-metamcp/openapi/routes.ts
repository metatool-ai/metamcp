import { ListToolsRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import {
  ApiKeyAuthenticatedRequest,
  authenticateApiKey,
} from "@/middleware/api-key-oauth.middleware";

import { metaMcpServerPool } from "../../../lib/metamcp/metamcp-server-pool";
import { lookupEndpoint } from "../../../middleware/lookup-endpoint-middleware";
import { createMiddlewareEnabledHandlers } from "./handlers";
import { generateOpenApiSchema } from "./schema-generator";
import { executeToolWithMiddleware } from "./tool-execution";
import { ToolExecutionRequest } from "./types";

const openApiRouter = express.Router();

// Generic API endpoint that serves the OpenAPI docs UI
openApiRouter.get(
  "/:endpoint_name/api",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    const { endpointName } = req as ApiKeyAuthenticatedRequest;

    // Return a simple HTML page with Swagger UI
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>${endpointName} API Documentation</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui.css" />
    <style>
        html {
            box-sizing: border-box;
            overflow: -moz-scrollbars-vertical;
            overflow-y: scroll;
        }
        *, *:before, *:after {
            box-sizing: inherit;
        }
        body {
            margin: 0;
            background: #fafafa;
        }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.10.3/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                url: '/metamcp/${endpointName}/api/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout"
            });
        }
    </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  },
);

// OpenAPI JSON schema endpoint (must come before tool execution routes)
openApiRouter.get(
  "/:endpoint_name/api/openapi.json",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    const { namespaceUuid, endpointName } = req as ApiKeyAuthenticatedRequest;

    try {
      // Get or create persistent OpenAPI session for this namespace
      const mcpServerInstance =
        await metaMcpServerPool.getOpenApiServer(namespaceUuid);
      if (!mcpServerInstance) {
        throw new Error("Failed to get MetaMCP server instance from pool");
      }

      // Use deterministic session ID for OpenAPI endpoints
      const sessionId = `openapi_${namespaceUuid}`;

      // Create middleware-enabled handlers
      const { handlerContext, listToolsWithMiddleware } =
        createMiddlewareEnabledHandlers(sessionId, namespaceUuid);

      // Use middleware-enabled list tools handler
      const listToolsRequest: ListToolsRequest = {
        method: "tools/list",
        params: {},
      };

      const result = await listToolsWithMiddleware(
        listToolsRequest,
        handlerContext,
      );

      const openApiSchema = await generateOpenApiSchema(
        result.tools || [],
        endpointName,
      );

      res.json(openApiSchema);
    } catch (error) {
      console.error("Error generating OpenAPI schema:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to generate OpenAPI schema",
        timestamp: new Date().toISOString(),
      });
    }
  },
);

// Tool execution endpoint for POST requests
openApiRouter.post(
  "/:endpoint_name/api/:tool_name",
  express.json(),
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    await executeToolWithMiddleware(
      req as ToolExecutionRequest,
      res,
      req.body || {},
    );
  },
);

// Tool execution endpoint for GET requests (for tools with no parameters)
openApiRouter.get(
  "/:endpoint_name/api/:tool_name",
  lookupEndpoint,
  authenticateApiKey,
  async (req, res) => {
    await executeToolWithMiddleware(req as ToolExecutionRequest, res, {});
  },
);

export default openApiRouter;
