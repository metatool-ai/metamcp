import {
  DeleteOAuthClientRequestSchema,
  DeleteOAuthClientResponseSchema,
  GetAllOAuthClientsResponseSchema,
  GetMcpRequestLogsRequestSchema,
  GetMcpRequestLogsResponseSchema,
  GetMcpServerCallLogsRequestSchema,
  GetMcpServerCallLogsResponseSchema,
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

import { adminProcedure, router } from "../../trpc";

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
    getMcpServerCallLogs: (
      input: z.infer<typeof GetMcpServerCallLogsRequestSchema>,
    ) => Promise<z.infer<typeof GetMcpServerCallLogsResponseSchema>>;
  },
) => {
  return router({
    // Admin only: Get OAuth session by MCP server UUID
    get: adminProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    // Admin only: Upsert OAuth session
    upsert: adminProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.upsert(input);
      }),

    // Admin only: Get all registered OAuth clients
    getAllClients: adminProcedure
      .output(GetAllOAuthClientsResponseSchema)
      .query(async () => {
        return await implementations.getAllClients();
      }),

    // Admin only: Update OAuth client admin access
    updateClientAdminAccess: adminProcedure
      .input(UpdateOAuthClientAdminAccessRequestSchema)
      .output(UpdateOAuthClientAdminAccessResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.updateClientAdminAccess(input);
      }),

    // Admin only: Delete OAuth client
    deleteClient: adminProcedure
      .input(DeleteOAuthClientRequestSchema)
      .output(DeleteOAuthClientResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.deleteClient(input);
      }),

    // Admin only: Get OAuth request logs
    getRequestLogs: adminProcedure
      .input(GetOAuthRequestLogsRequestSchema)
      .output(GetOAuthRequestLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getRequestLogs(input);
      }),

    // Admin only: Get MCP request logs
    getMcpRequestLogs: adminProcedure
      .input(GetMcpRequestLogsRequestSchema)
      .output(GetMcpRequestLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getMcpRequestLogs(input);
      }),

    // Admin only: Get MCP server call logs (MetaMCP -> Real MCP Server calls)
    getMcpServerCallLogs: adminProcedure
      .input(GetMcpServerCallLogsRequestSchema)
      .output(GetMcpServerCallLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getMcpServerCallLogs(input);
      }),
  });
};
