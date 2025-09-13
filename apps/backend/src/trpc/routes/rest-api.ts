import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  RestApiImportRequestSchema,
  RestApiImportResponseSchema,
  ValidateApiSpecRequestSchema,
  ValidateApiSpecResponseSchema,
  SimpleJsonApiSchema,
  OpenApiSpecSchema,
  ManualApiFormSchema,
  RestApiSpecification,
  AuthConfiguration,
} from "@repo/zod-types";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { RestApiConverter } from "../../lib/rest-api/rest-api-converter";
import { mcpServersRepo } from "../../db/repositories";

export const restApiRouter = createTRPCRouter({
  /**
   * Validate REST API specification before import
   */
  validateSpec: protectedProcedure
    .input(ValidateApiSpecRequestSchema)
    .output(ValidateApiSpecResponseSchema)
    .mutation(async ({ input }) => {
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
    }),

  /**
   * Import REST API and create MCP server
   */
  importApi: protectedProcedure
    .input(RestApiImportRequestSchema)
    .output(RestApiImportResponseSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const converter = new RestApiConverter();
        const result = await converter.validateAndConvert(input.format, input.data);
        
        // Create MCP server record
        const serverData = {
          name: input.server_name,
          description: input.server_description || null,
          type: "REST_API" as const,
          command: null,
          args: null,
          url: null,
          bearer_token: null,
          env: null,
          user_id: ctx.user.id,
          // REST API specific fields
          api_spec: result.apiSpec,
          base_url: result.baseUrl,
          auth_config: result.authConfig,
        };

        const createdServer = await mcpServersRepo.create(serverData);
        
        // Generate tool names for response
        const toolNames = result.apiSpec.endpoints.map(endpoint => 
          `${input.server_name.replace(/[^a-zA-Z0-9_-]/g, '_')}__${endpoint.name}`
        );

        return {
          success: true,
          data: {
            server_uuid: createdServer.uuid,
            endpoints_count: result.apiSpec.endpoints.length,
            tools_generated: toolNames,
          },
          message: `Successfully imported ${result.apiSpec.endpoints.length} endpoints`,
        };
      } catch (error) {
        console.error("REST API import failed:", error);
        
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Import failed",
        });
      }
    }),

  /**
   * Test REST API connection
   */
  testConnection: protectedProcedure
    .input(z.object({
      base_url: z.string().url(),
      auth_config: z.any().optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      response_time: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
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
    }),

  /**
   * Get REST API server details
   */
  getServerDetails: protectedProcedure
    .input(z.object({
      server_uuid: z.string(),
    }))
    .output(z.object({
      server: z.any(),
      endpoints: z.array(z.object({
        name: z.string(),
        method: z.string(),
        path: z.string(),
        description: z.string().optional(),
        parameters_count: z.number(),
      })),
      tools_count: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const server = await mcpServersRepo.findByUuid(input.server_uuid);
      
      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      if (server.user_id !== ctx.user.id) {
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
    }),

  /**
   * Update REST API server configuration
   */
  updateServer: protectedProcedure
    .input(z.object({
      server_uuid: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      base_url: z.string().url().optional(),
      auth_config: z.any().optional(),
      api_spec: z.any().optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const server = await mcpServersRepo.findByUuid(input.server_uuid);
      
      if (!server) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Server not found",
        });
      }

      if (server.user_id !== ctx.user.id) {
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

      await mcpServersRepo.update(server.uuid, updateData);

      return {
        success: true,
        message: "Server updated successfully",
      };
    }),
});
