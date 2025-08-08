import {
  ClearLogsResponseSchema,
  GetDockerLogsRequestSchema,
  GetDockerLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
  ListDockerServersResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Define the logs router with procedure definitions
// The actual implementation will be provided by the backend
export const createLogsRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    getLogs: (
      input: z.infer<typeof GetLogsRequestSchema>,
    ) => Promise<z.infer<typeof GetLogsResponseSchema>>;
    clearLogs: () => Promise<z.infer<typeof ClearLogsResponseSchema>>;
    listDockerServers: (
      userId: string,
    ) => Promise<z.infer<typeof ListDockerServersResponseSchema>>;
    getDockerLogs: (
      input: z.infer<typeof GetDockerLogsRequestSchema>,
    ) => Promise<z.infer<typeof GetDockerLogsResponseSchema>>;
  },
) =>
  router({
    // Protected: Get logs with optional limit
    get: protectedProcedure
      .input(GetLogsRequestSchema)
      .output(GetLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getLogs(input);
      }),

    // Protected: Clear all logs
    clear: protectedProcedure
      .output(ClearLogsResponseSchema)
      .mutation(async () => {
        return await implementations.clearLogs();
      }),

    // Protected: List docker-managed MCP server containers
    listDockerServers: protectedProcedure
      .output(ListDockerServersResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.listDockerServers(ctx.user.id);
      }),

    // Protected: Get logs tail for a docker-managed MCP server
    dockerLogs: protectedProcedure
      .input(GetDockerLogsRequestSchema)
      .output(GetDockerLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getDockerLogs(input);
      }),
  });
