import {
  DeleteOAuthClientRequestSchema,
  DeleteOAuthClientResponseSchema,
  GetAllOAuthClientsResponseSchema,
  GetMcpRequestLogsRequestSchema,
  GetMcpRequestLogsResponseSchema,
  GetOAuthRequestLogsRequestSchema,
  GetOAuthRequestLogsResponseSchema,
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  UpdateOAuthClientAdminAccessRequestSchema,
  UpdateOAuthClientAdminAccessResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Define the OAuth router with procedure definitions
// The actual implementation will be provided by the backend
export const createOAuthRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    get: (
      input: z.infer<typeof GetOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof GetOAuthSessionResponseSchema>>;
    upsert: (
      input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>>;
    getAllClients: () => Promise<z.infer<typeof GetAllOAuthClientsResponseSchema>>;
    updateClientAdminAccess: (
      input: z.infer<typeof UpdateOAuthClientAdminAccessRequestSchema>,
    ) => Promise<z.infer<typeof UpdateOAuthClientAdminAccessResponseSchema>>;
    deleteClient: (
      input: z.infer<typeof DeleteOAuthClientRequestSchema>,
    ) => Promise<z.infer<typeof DeleteOAuthClientResponseSchema>>;
    getRequestLogs: (
      input: z.infer<typeof GetOAuthRequestLogsRequestSchema>,
    ) => Promise<z.infer<typeof GetOAuthRequestLogsResponseSchema>>;
    getMcpRequestLogs: (
      input: z.infer<typeof GetMcpRequestLogsRequestSchema>,
    ) => Promise<z.infer<typeof GetMcpRequestLogsResponseSchema>>;
  },
) => {
  return router({
    // Protected: Get OAuth session by MCP server UUID
    get: protectedProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    // Protected: Upsert OAuth session
    upsert: protectedProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.upsert(input);
      }),

    // Protected: Get all registered OAuth clients
    getAllClients: protectedProcedure
      .output(GetAllOAuthClientsResponseSchema)
      .query(async () => {
        return await implementations.getAllClients();
      }),

    // Protected: Update OAuth client admin access
    updateClientAdminAccess: protectedProcedure
      .input(UpdateOAuthClientAdminAccessRequestSchema)
      .output(UpdateOAuthClientAdminAccessResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.updateClientAdminAccess(input);
      }),

    // Protected: Delete OAuth client
    deleteClient: protectedProcedure
      .input(DeleteOAuthClientRequestSchema)
      .output(DeleteOAuthClientResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.deleteClient(input);
      }),

    // Protected: Get OAuth request logs
    getRequestLogs: protectedProcedure
      .input(GetOAuthRequestLogsRequestSchema)
      .output(GetOAuthRequestLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getRequestLogs(input);
      }),

    // Protected: Get MCP request logs
    getMcpRequestLogs: protectedProcedure
      .input(GetMcpRequestLogsRequestSchema)
      .output(GetMcpRequestLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getMcpRequestLogs(input);
      }),
  });
};
