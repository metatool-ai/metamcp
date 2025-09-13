import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  RestApiEndpoint,
  RestApiParameter,
  RestApiSpecification,
} from "@repo/zod-types";

export interface McpToolFromEndpoint extends Tool {
  // Additional metadata for REST API tools
  _restApi: {
    endpoint: RestApiEndpoint;
    serverName: string;
  };
}

export class RestApiToolGenerator {
  /**
   * Generate MCP tools from REST API specification
   */
  static generateTools(
    apiSpec: RestApiSpecification,
    serverName: string,
  ): McpToolFromEndpoint[] {
    const tools: McpToolFromEndpoint[] = [];

    for (const endpoint of apiSpec.endpoints) {
      const tool = this.generateToolFromEndpoint(endpoint, serverName);
      tools.push(tool);
    }

    return tools;
  }

  /**
   * Generate a single MCP tool from a REST API endpoint
   */
  private static generateToolFromEndpoint(
    endpoint: RestApiEndpoint,
    serverName: string,
  ): McpToolFromEndpoint {
    const toolName = `${this.sanitizeName(serverName)}__${endpoint.name}`;

    // Build tool description
    let description =
      endpoint.description || `${endpoint.method} ${endpoint.path}`;
    if (endpoint.parameters && endpoint.parameters.length > 0) {
      const requiredParams = endpoint.parameters.filter((p) => p.required);
      if (requiredParams.length > 0) {
        description += `\n\nRequired parameters: ${requiredParams.map((p) => p.name).join(", ")}`;
      }
    }

    // Build input schema for the tool
    const inputSchema = this.buildInputSchema(endpoint);

    return {
      name: toolName,
      description,
      inputSchema,
      _restApi: {
        endpoint,
        serverName,
      },
    };
  }

  /**
   * Build JSON schema for tool input parameters
   */
  private static buildInputSchema(endpoint: RestApiEndpoint): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add parameters as properties
    if (endpoint.parameters) {
      for (const param of endpoint.parameters) {
        properties[param.name] = this.parameterToJsonSchema(param);

        if (param.required) {
          required.push(param.name);
        }
      }
    }

    // Add request body as 'body' parameter if present
    if (endpoint.requestBody) {
      properties.body = {
        type: "object",
        description: "Request body data",
        ...(endpoint.requestBody.schema || {}),
      };

      if (endpoint.requestBody.required) {
        required.push("body");
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  /**
   * Convert REST API parameter to JSON schema property
   */
  private static parameterToJsonSchema(param: RestApiParameter): any {
    const schema: any = {
      description: param.description,
    };

    // Map parameter types to JSON schema types
    switch (param.type) {
      case "string":
        schema.type = "string";
        if (param.enum) {
          schema.enum = param.enum;
        }
        break;
      case "number":
        schema.type = "number";
        break;
      case "boolean":
        schema.type = "boolean";
        break;
      case "array":
        schema.type = "array";
        schema.items = { type: "string" }; // Default to string array
        break;
      default:
        schema.type = "string";
    }

    // Add default value if present
    if (param.default !== undefined) {
      schema.default = param.default;
    }

    return schema;
  }

  /**
   * Sanitize server name for use in tool names
   */
  private static sanitizeName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
  }

  /**
   * Extract tool name from full MCP tool name
   */
  static extractEndpointName(toolName: string): string {
    const parts = toolName.split("__");
    return parts.length > 1 ? parts.slice(1).join("__") : toolName;
  }

  /**
   * Extract server name from full MCP tool name
   */
  static extractServerName(toolName: string): string {
    const parts = toolName.split("__");
    return parts.length > 1 ? parts[0] : "";
  }

  /**
   * Check if a tool name matches the REST API naming pattern
   */
  static isRestApiTool(toolName: string): boolean {
    return toolName.includes("__") && toolName.split("__").length >= 2;
  }

  /**
   * Generate tool documentation
   */
  static generateToolDocumentation(tool: McpToolFromEndpoint): string {
    const endpoint = tool._restApi.endpoint;
    let doc = `# ${tool.name}\n\n`;
    doc += `**Method:** ${endpoint.method}\n`;
    doc += `**Path:** ${endpoint.path}\n\n`;

    if (endpoint.description) {
      doc += `**Description:** ${endpoint.description}\n\n`;
    }

    if (endpoint.parameters && endpoint.parameters.length > 0) {
      doc += `## Parameters\n\n`;
      for (const param of endpoint.parameters) {
        doc += `- **${param.name}** (${param.type}, ${param.in})`;
        if (param.required) doc += ` *required*`;
        if (param.description) doc += `: ${param.description}`;
        doc += `\n`;
      }
      doc += `\n`;
    }

    if (endpoint.requestBody) {
      doc += `## Request Body\n\n`;
      doc += `- **Content-Type:** ${endpoint.requestBody.contentType}\n`;
      if (endpoint.requestBody.required) doc += `- **Required:** Yes\n`;
      doc += `\n`;
    }

    if (endpoint.responses && endpoint.responses.length > 0) {
      doc += `## Responses\n\n`;
      for (const response of endpoint.responses) {
        doc += `- **${response.statusCode}**`;
        if (response.description) doc += `: ${response.description}`;
        doc += `\n`;
      }
    }

    return doc;
  }

  /**
   * Validate endpoint configuration
   */
  static validateEndpoint(endpoint: RestApiEndpoint): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!endpoint.name || endpoint.name.trim() === "") {
      errors.push("Endpoint name is required");
    }

    if (!endpoint.path || endpoint.path.trim() === "") {
      errors.push("Endpoint path is required");
    }

    if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(endpoint.method)) {
      errors.push("Invalid HTTP method");
    }

    // Validate path parameters are defined
    if (endpoint.path) {
      const pathParams = endpoint.path.match(/\{([^}]+)\}/g) || [];
      const definedParams =
        endpoint.parameters
          ?.filter((p) => p.in === "path")
          .map((p) => `{${p.name}}`) || [];

      for (const pathParam of pathParams) {
        if (!definedParams.includes(pathParam)) {
          errors.push(
            `Path parameter ${pathParam} is not defined in parameters`,
          );
        }
      }
    }

    // Validate required parameters
    if (endpoint.parameters) {
      for (const param of endpoint.parameters) {
        if (!param.name || param.name.trim() === "") {
          errors.push("Parameter name is required");
        }
        if (!["path", "query", "header"].includes(param.in)) {
          errors.push(`Invalid parameter location: ${param.in}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
