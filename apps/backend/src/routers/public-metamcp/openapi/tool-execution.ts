import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { createServer } from "../../../lib/metamcp/metamcp-proxy";
import { createMiddlewareEnabledHandlers } from "./handlers";
import { ToolExecutionRequest } from "./types";

// Refactored tool execution logic to use middleware
export const executeToolWithMiddleware = async (
  req: ToolExecutionRequest,
  res: express.Response,
  toolArguments: Record<string, unknown>,
) => {
  const { namespaceUuid } = req;
  const toolName = req.params.tool_name;

  try {
    // Create MetaMCP server instance directly using metamcp-proxy for OpenAPI
    const mcpServerInstance = await createServer(
      namespaceUuid,
      `openapi_${namespaceUuid}`,
    );
    if (!mcpServerInstance) {
      throw new Error("Failed to create MetaMCP server instance");
    }

    // Create middleware-enabled handlers
    const { handlerContext, callToolWithMiddleware } =
      createMiddlewareEnabledHandlers(namespaceUuid);

    // Use middleware-enabled call tool handler
    const callToolRequest: CallToolRequest = {
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArguments,
      },
    };

    const result = await callToolWithMiddleware(
      callToolRequest,
      handlerContext,
    );

    // Check if the result indicates an error (from middleware)
    if (result.isError) {
      return res.status(403).json({
        error: "Tool access denied",
        message: result.content?.[0]?.text || "Tool is inactive",
        timestamp: new Date().toISOString(),
      });
    }

    // Return the result directly (simplified format)
    res.json(result);
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);

    // Handle different types of errors
    if (error instanceof Error) {
      if (error.message.includes("Unknown tool")) {
        return res.status(404).json({
          error: "Tool not found",
          message: `Tool '${toolName}' not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(500).json({
        error: "Tool execution failed",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(500).json({
      error: "Internal server error",
      message: "Failed to execute tool",
      timestamp: new Date().toISOString(),
    });
  }
};
