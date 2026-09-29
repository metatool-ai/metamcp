import {
  ClearLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, router } from "../../trpc";

// Define the logs router with procedure definitions
// The actual implementation will be provided by the backend
export const createLogsRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    getLogs: (
      input: z.infer<typeof GetLogsRequestSchema>,
    ) => Promise<z.infer<typeof GetLogsResponseSchema>>;
    clearLogs: () => Promise<z.infer<typeof ClearLogsResponseSchema>>;
  },
) =>
  router({
    // Admin only: live logs contain the stderr of every MCP server
    get: adminProcedure
      .input(GetLogsRequestSchema)
      .output(GetLogsResponseSchema)
      .query(async ({ input }) => {
        return await implementations.getLogs(input);
      }),

    // Admin only: clear all logs
    clear: adminProcedure.output(ClearLogsResponseSchema).mutation(async () => {
      return await implementations.clearLogs();
    }),
  });
