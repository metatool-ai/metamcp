import {
  ClearLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
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
  });
