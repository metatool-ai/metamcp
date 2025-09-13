import { z } from "zod";
import {
  RestApiImportRequestSchema,
  RestApiImportResponseSchema,
  ValidateApiSpecRequestSchema,
  ValidateApiSpecResponseSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export interface RestApiImplementation {
  validateSpec: (input: z.infer<typeof ValidateApiSpecRequestSchema>) => Promise<z.infer<typeof ValidateApiSpecResponseSchema>>;
  importApi: (input: z.infer<typeof RestApiImportRequestSchema>, userId: string) => Promise<z.infer<typeof RestApiImportResponseSchema>>;
  testConnection: (input: { base_url: string; auth_config?: any }) => Promise<{ success: boolean; message: string; response_time?: number }>;
  getServerDetails: (input: { server_uuid: string }, userId: string) => Promise<{
    server: any;
    endpoints: Array<{
      name: string;
      method: string;
      path: string;
      description?: string;
      parameters_count: number;
    }>;
    tools_count: number;
  }>;
  updateServer: (input: {
    server_uuid: string;
    name?: string;
    description?: string;
    base_url?: string;
    auth_config?: any;
    api_spec?: any;
  }, userId: string) => Promise<{ success: boolean; message: string }>;
}

export const createRestApiRouter = (implementation: RestApiImplementation) => {
  return router({
    /**
     * Validate REST API specification before import
     */
    validateSpec: protectedProcedure
      .input(ValidateApiSpecRequestSchema)
      .output(ValidateApiSpecResponseSchema)
      .mutation(async ({ input }) => {
        return await implementation.validateSpec(input);
      }),

    /**
     * Import REST API and create MCP server
     */
    importApi: protectedProcedure
      .input(RestApiImportRequestSchema)
      .output(RestApiImportResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementation.importApi(input, ctx.user.id);
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
        return await implementation.testConnection(input);
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
        return await implementation.getServerDetails(input, ctx.user.id);
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
        return await implementation.updateServer(input, ctx.user.id);
      }),
  });
};
