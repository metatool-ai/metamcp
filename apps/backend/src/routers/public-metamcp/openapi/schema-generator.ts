import { Tool } from "@modelcontextprotocol/sdk/types.js";

import { OpenApiSchema } from "./types";

// Convert MCP tools to OpenAPI schema
export const generateOpenApiSchema = async (
  tools: Tool[],
  endpointName: string,
): Promise<OpenApiSchema> => {
  const paths: Record<string, unknown> = {};

  // Convert each MCP tool to an OpenAPI path (mounted directly to root, no /tools/ prefix)
  for (const tool of tools) {
    const toolPath = `/${tool.name}`;
    const operationId = tool.name.replace(/[^a-zA-Z0-9]/g, "_");

    // Create request body schema from tool input schema
    const requestBodySchema = tool.inputSchema || {
      type: "object",
      properties: {},
    };

    // Determine HTTP method based on tool characteristics
    const httpMethod =
      requestBodySchema.properties &&
      Object.keys(requestBodySchema.properties).length > 0
        ? "post"
        : "get";

    const pathDefinition: Record<string, unknown> = {
      summary: tool.description || tool.name,
      operationId: `${operationId}`,
      responses: {
        "200": {
          description: "Successful Response",
          content: {
            "application/json": {
              schema: {},
            },
          },
        },
        "422": {
          description: "Validation Error",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/HTTPValidationError",
              },
            },
          },
        },
      },
    };

    // Add request body for POST requests
    if (httpMethod === "post") {
      pathDefinition.requestBody = {
        content: {
          "application/json": {
            schema: requestBodySchema,
          },
        },
        required: true,
      };
    }

    paths[toolPath] = {
      [httpMethod]: pathDefinition,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${endpointName} Server`,
      description: `API server for ${endpointName} tools and utilities.`,
      version: "1.0.0",
    },
    paths,
    components: {
      schemas: {
        HTTPValidationError: {
          properties: {
            detail: {
              items: {
                $ref: "#/components/schemas/ValidationError",
              },
              type: "array",
              title: "Detail",
            },
          },
          type: "object",
          title: "HTTPValidationError",
        },
        ValidationError: {
          properties: {
            loc: {
              items: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "integer",
                  },
                ],
              },
              type: "array",
              title: "Location",
            },
            msg: {
              type: "string",
              title: "Message",
            },
            type: {
              type: "string",
              title: "Error Type",
            },
          },
          type: "object",
          required: ["loc", "msg", "type"],
          title: "ValidationError",
        },
      },
    },
  };
};
