import { TRPCError } from "@trpc/server";
import { z } from "zod";
import crypto from "crypto";
import {
  RestApiImportRequestSchema,
  RestApiImportResponseSchema,
  ValidateApiSpecRequestSchema,
  ValidateApiSpecResponseSchema,
  RestApiSpecification,
  AuthConfiguration,
} from "@repo/zod-types";
import type { RestApiImplementation } from "@repo/trpc";

import { RestApiConverter } from "../lib/rest-api/rest-api-converter";
import { RestApiToolGenerator } from "../lib/rest-api/tool-generator";
import { mcpServersRepository, restApiToolsRepository } from "../db/repositories";

// Helper function to encode auth configuration for storage
function encodeAuthValue(authConfig?: AuthConfiguration): string | null {
  if (!authConfig || authConfig.type === "none") {
    return null;
  }

  switch (authConfig.type) {
    case "bearer":
      return JSON.stringify({
        Authorization: `Bearer ${authConfig.config.token}`,
      });
    case "basic":
      const credentials = Buffer.from(
        `${authConfig.config.username}:${authConfig.config.password}`
      ).toString("base64");
      return JSON.stringify({
        Authorization: `Basic ${credentials}`,
      });
    case "api_key":
      const headerName = authConfig.config.location === "header"
        ? authConfig.config.name
        : "X-API-Key";
      return JSON.stringify({
        [headerName]: authConfig.config.key,
      });
    default:
      return null;
  }
}

export const restApiImplementation: RestApiImplementation = {
  /**
   * Validate REST API specification before import
   */
  async validateSpec(input: z.infer<typeof ValidateApiSpecRequestSchema>) {
    try {
      const converter = new RestApiConverter();
      const result = await converter.validateAndConvert(input.format, input.data);
      
      return {
        success: true,
        data: {
          endpoints_count: result.apiSpec.endpoints.length,
          endpoints_preview: result.apiSpec.endpoints.slice(0, 5).map(endpoint => ({
            name: endpoint.name,
            method: endpoint.method,
            path: endpoint.path,
            description: endpoint.description,
          })),
          warnings: result.warnings,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Validation failed",
      };
    }
  },

  /**
   * Import REST API and register endpoints as individual tools (IBM approach)
   */
  async importApi(input: z.infer<typeof RestApiImportRequestSchema>, userId: string) {
    try {
      const converter = new RestApiConverter();
      const result = await converter.validateAndConvert(input.format, input.data);

      // Create a STDIO server that uses our virtual REST API MCP server
      const serverData = {
        name: input.server_name,
        description: input.server_description || null,
        type: "STDIO" as const,
        command: "node",
        args: [
          "/app/apps/backend/dist/lib/rest-api/rest-api-mcp-server.js",
          "{{SERVER_UUID}}", // Will be replaced with actual UUID after creation
          input.server_name,
        ],
        url: null,
        bearer_token: null,
        env: {},
        user_id: userId,
        // REST API specific fields (for reference)
        api_spec: result.apiSpec,
        base_url: result.baseUrl,
        auth_config: result.authConfig,
      };

      const createdServer = await mcpServersRepository.create(serverData);

      // Update the command args with the actual server UUID
      await mcpServersRepository.update({
        uuid: createdServer.uuid,
        args: [
          "/app/apps/backend/dist/lib/rest-api/rest-api-mcp-server.js",
          createdServer.uuid,
          input.server_name,
        ],
      });

      // Generate tools for each endpoint using IBM's approach
      const tools = RestApiToolGenerator.generateTools(result.apiSpec, input.server_name);

      // Register each endpoint as an individual tool
      const createdTools = [];
      for (const tool of tools) {
        const toolData = {
          name: `${input.server_name.replace(/[^a-zA-Z0-9_-]/g, '_')}__${tool.name}`,
          display_name: tool.displayName || tool.name,
          description: tool.description,
          url: `${result.baseUrl}${tool._restApi.endpoint.path}`,
          integration_type: "REST" as const,
          request_type: tool._restApi.endpoint.method,
          input_schema: tool.inputSchema,
          headers: tool._restApi.endpoint.headers || {},
          auth_type: result.authConfig?.type || "none",
          auth_value: encodeAuthValue(result.authConfig),
          server_id: createdServer.uuid,
          user_id: userId,
          enabled: true,
        };

        const createdTool = await restApiToolsRepository.create(toolData);
        createdTools.push(createdTool);
      }

      return {
        success: true,
        data: {
          server_uuid: createdServer.uuid,
          endpoints_count: result.apiSpec.endpoints.length,
          tools_generated: createdTools.map(tool => tool.name),
        },
        message: `Successfully imported ${result.apiSpec.endpoints.length} endpoints as tools`,
      };
    } catch (error) {
      console.error("REST API import failed:", error);

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Import failed",
      });
    }
  },

  /**
   * Test REST API connection
   */
  async testConnection(input: { base_url: string; auth_config?: any }) {
    try {
      const startTime = Date.now();
      
      // Create a simple HEAD request to test connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(input.base_url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'MetaMCP-RestAPI/1.0',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      return {
        success: response.ok,
        message: response.ok 
          ? `Connection successful (${response.status} ${response.statusText})`
          : `Connection failed: ${response.status} ${response.statusText}`,
        response_time: responseTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      return {
        success: false,
        message: message.includes('AbortError') ? 'Connection timeout' : message,
      };
    }
  },

  /**
   * Get REST API server details
   */
  async getServerDetails(input: { server_uuid: string }, userId: string) {
    const server = await mcpServersRepository.findByUuid(input.server_uuid);
    
    if (!server) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Server not found",
      });
    }

    if (server.user_id !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }

    if (server.type !== "REST_API" || !server.api_spec) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Not a REST API server",
      });
    }

    const apiSpec = server.api_spec as RestApiSpecification;
    const endpoints = apiSpec.endpoints.map(endpoint => ({
      name: endpoint.name,
      method: endpoint.method,
      path: endpoint.path,
      description: endpoint.description,
      parameters_count: endpoint.parameters?.length || 0,
    }));

    return {
      server,
      endpoints,
      tools_count: endpoints.length,
    };
  },

  /**
   * Update REST API server configuration
   */
  async updateServer(input: {
    server_uuid: string;
    name?: string;
    description?: string;
    base_url?: string;
    auth_config?: any;
    api_spec?: any;
  }, userId: string) {
    const server = await mcpServersRepository.findByUuid(input.server_uuid);
    
    if (!server) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Server not found",
      });
    }

    if (server.user_id !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }

    if (server.type !== "REST_API") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Not a REST API server",
      });
    }

    const updateData: any = {};
    
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.base_url !== undefined) updateData.base_url = input.base_url;
    if (input.auth_config !== undefined) updateData.auth_config = input.auth_config;
    if (input.api_spec !== undefined) updateData.api_spec = input.api_spec;

    await mcpServersRepository.update({
      uuid: server.uuid,
      ...updateData,
    });

    return {
      success: true,
      message: "Server updated successfully",
    };
  },
};
