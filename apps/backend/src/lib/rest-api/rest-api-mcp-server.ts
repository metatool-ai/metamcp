import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  RestApiTool,
  restApiToolsRepository,
} from "../../db/repositories/rest-api-tools.repo";
import { restApiToolExecutor } from "./rest-api-tool-executor";

/**
 * Virtual MCP Server that exposes REST API tools (IBM approach)
 * This server dynamically loads REST API tools from the database
 * and exposes them as MCP tools
 */
export class RestApiMcpServer {
  private server: Server;
  private serverId: string;
  private tools: RestApiTool[] = [];

  constructor(serverId: string, serverName: string) {
    this.serverId = serverId;
    this.server = new Server(
      {
        name: serverName,
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.loadTools();

      return {
        tools: this.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || `${tool.request_type} ${tool.url}`,
          inputSchema: tool.input_schema,
        })),
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.loadTools();

      const tool = this.tools.find((t) => t.name === request.params.name);
      if (!tool) {
        throw new Error(`Tool not found: ${request.params.name}`);
      }

      if (!tool.enabled) {
        throw new Error(`Tool is disabled: ${request.params.name}`);
      }

      // Validate parameters
      const validation = restApiToolExecutor.validateParameters(
        tool,
        request.params.arguments || {},
      );
      if (!validation.valid) {
        throw new Error(
          `Parameter validation failed: ${validation.errors.join(", ")}`,
        );
      }

      // Execute the tool
      const result = await restApiToolExecutor.executeTool({
        tool,
        parameters: request.params.arguments || {},
      });

      if (!result.success) {
        throw new Error(result.error || "Tool execution failed");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: result.status,
                data: result.data,
                headers: result.headers,
                executionTime: result.executionTime,
              },
              null,
              2,
            ),
          },
        ],
      };
    });
  }

  private async loadTools() {
    try {
      console.log(`Loading tools for server ${this.serverId}...`);
      this.tools = await restApiToolsRepository.findByServerId(this.serverId);
      console.log(
        `Loaded ${this.tools.length} tools for server ${this.serverId}`,
      );
    } catch (error) {
      console.error(`Failed to load tools for server ${this.serverId}:`, error);
      this.tools = [];
    }
  }

  async start() {
    try {
      console.log(
        `Starting REST API MCP Server for server ID: ${this.serverId}`,
      );
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.log(
        `REST API MCP Server started for server ID: ${this.serverId}`,
      );
    } catch (error) {
      console.error(
        `Failed to start REST API MCP Server for server ID: ${this.serverId}:`,
        error,
      );
      process.exit(1);
    }
  }
}

/**
 * Factory function to create and start a REST API MCP server
 */
export async function createRestApiMcpServer(
  serverId: string,
  serverName: string,
) {
  const server = new RestApiMcpServer(serverId, serverName);
  await server.start();
  return server;
}

// If this file is run directly, start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const serverId = process.argv[2];
  const serverName = process.argv[3] || "REST API Server";

  if (!serverId) {
    console.error("Usage: node rest-api-mcp-server.js <serverId> [serverName]");
    process.exit(1);
  }

  createRestApiMcpServer(serverId, serverName).catch((error) => {
    console.error("Failed to start REST API MCP server:", error);
    process.exit(1);
  });
}
