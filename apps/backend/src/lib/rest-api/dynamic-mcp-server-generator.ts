import { AuthConfiguration, RestApiSpecification, ServerParameters } from "@repo/zod-types";
import path from "path";
import fs from "fs/promises";

import { RestApiClient } from "./rest-client";
import { RestApiToolGenerator } from "./tool-generator";

/**
 * Dynamic MCP Server Generator for REST APIs
 * Creates standalone MCP servers that can be run via STDIO, SSE, or HTTP
 */
export class DynamicMcpServerGenerator {
  /**
   * Generate a standalone MCP server script for a REST API
   */
  static async generateServerScript(serverParams: ServerParameters): Promise<string> {
    if (serverParams.type !== "REST_API") {
      throw new Error("Invalid server type for REST API server");
    }

    if (!serverParams.base_url || !serverParams.api_spec) {
      throw new Error("base_url and api_spec are required for REST API servers");
    }

    const apiSpec = serverParams.api_spec as RestApiSpecification;
    const authConfig = serverParams.auth_config as AuthConfiguration | undefined;
    const tools = RestApiToolGenerator.generateTools(apiSpec, serverParams.name);

    // Generate the server script
    const serverScript = `#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

// REST API Configuration
const API_CONFIG = ${JSON.stringify({
  name: serverParams.name,
  baseUrl: serverParams.base_url,
  apiSpec,
  authConfig
}, null, 2)};

// HTTP Client for REST API calls
class RestApiClient {
  constructor(baseUrl, authConfig) {
    this.baseUrl = baseUrl;
    this.authConfig = authConfig;
  }

  async makeRequest(method, path, params = {}) {
    const url = new URL(path, this.baseUrl);
    
    // Add query parameters for GET requests
    if (method === 'GET' && params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'MetaMCP-REST-API-Server/1.0.0'
    };

    // Add authentication
    if (this.authConfig) {
      switch (this.authConfig.type) {
        case 'bearer':
          headers['Authorization'] = \`Bearer \${this.authConfig.token}\`;
          break;
        case 'api_key':
          if (this.authConfig.location === 'header') {
            headers[this.authConfig.key] = this.authConfig.value;
          } else if (this.authConfig.location === 'query') {
            url.searchParams.append(this.authConfig.key, this.authConfig.value);
          }
          break;
        case 'basic':
          const credentials = btoa(\`\${this.authConfig.username}:\${this.authConfig.password}\`);
          headers['Authorization'] = \`Basic \${credentials}\`;
          break;
      }
    }

    const options = {
      method: method.toUpperCase(),
      headers
    };

    // Add body for non-GET requests
    if (method !== 'GET' && params && Object.keys(params).length > 0) {
      options.body = JSON.stringify(params);
    }

    try {
      const response = await fetch(url.toString(), options);
      const responseText = await response.text();
      
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: responseData,
        headers: Object.fromEntries(response.headers.entries())
      };
    } catch (error) {
      return {
        success: false,
        status: 0,
        statusText: 'Network Error',
        data: null,
        error: error.message
      };
    }
  }
}

// Create MCP Server
const createMcpServer = () => {
  const server = new McpServer({
    name: API_CONFIG.name,
    version: "1.0.0"
  }, {
    capabilities: {
      tools: {}
    }
  });

  const client = new RestApiClient(API_CONFIG.baseUrl, API_CONFIG.authConfig);

  // Register tools for each API endpoint
${tools.map(tool => `
  server.tool(${JSON.stringify(tool.name)}, ${JSON.stringify(tool.description)}, ${JSON.stringify(tool.inputSchema)}, async (params) => {
    const endpoint = API_CONFIG.apiSpec.endpoints.find(e => e.name === ${JSON.stringify(tool._restApi.endpoint.name)});
    if (!endpoint) {
      throw new Error("Endpoint not found: " + ${JSON.stringify(tool._restApi.endpoint.name)});
    }

    const result = await client.makeRequest(endpoint.method, endpoint.path, params);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: result.success,
            status: result.status,
            data: result.data,
            ...(result.error && { error: result.error })
          }, null, 2)
        }
      ]
    };
  });`).join('')}

  return server;
};

// Main function for different transport modes
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'stdio';

  const server = createMcpServer();

  switch (mode) {
    case 'stdio':
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error("${serverParams.name} MCP server running on STDIO");
      break;
      
    case 'sse':
      const port = parseInt(args[1]) || 3000;
      await startSseServer(server, port);
      break;
      
    default:
      console.error("Usage: node server.js [stdio|sse] [port]");
      process.exit(1);
  }
}

// SSE Server implementation
async function startSseServer(mcpServer, port) {
  const app = express();
  app.use(express.json());
  
  const transports = {};

  app.get('/mcp', async (req, res) => {
    try {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;
      
      transport.onclose = () => {
        delete transports[sessionId];
      };
      
      await mcpServer.connect(transport);
      console.error(\`SSE session established: \${sessionId}\`);
    } catch (error) {
      console.error('SSE connection error:', error);
      if (!res.headersSent) {
        res.status(500).send('Connection error');
      }
    }
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];
    
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }
    
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error('Message handling error:', error);
      if (!res.headersSent) {
        res.status(500).send('Message handling error');
      }
    }
  });

  app.listen(port, () => {
    console.error(\`${serverParams.name} MCP server running on SSE at http://localhost:\${port}\`);
  });
}

// Handle shutdown
process.on('SIGINT', () => {
  console.error("Shutting down ${serverParams.name} MCP server");
  process.exit(0);
});

main().catch(error => {
  console.error("Server error:", error);
  process.exit(1);
});
`;

    return serverScript;
  }

  /**
   * Create and save a standalone MCP server file
   */
  static async createServerFile(serverParams: ServerParameters, outputDir: string): Promise<string> {
    const script = await this.generateServerScript(serverParams);
    const fileName = `${serverParams.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_mcp_server.mjs`;
    const filePath = path.join(outputDir, fileName);
    
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(filePath, script, 'utf8');
    await fs.chmod(filePath, 0o755); // Make executable
    
    return filePath;
  }

  /**
   * Test connection to a REST API
   */
  static async testConnection(baseUrl: string, authConfig?: AuthConfiguration): Promise<{ success: boolean; message: string }> {
    try {
      const client = new RestApiClient(baseUrl, authConfig);
      
      // Try to make a simple request to test connectivity
      const result = await client.makeRequest('GET', '/', {});
      
      // Consider any response (even errors) as a successful connection
      // The important thing is that we can reach the server
      return {
        success: true,
        message: `Connection successful (HTTP ${result.status})`
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}
