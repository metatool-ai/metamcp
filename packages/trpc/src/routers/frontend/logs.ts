import {
  ClearLogsResponseSchema,
  GetLogsRequestSchema,
  GetLogsResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, protectedProcedure, router } from "../../trpc";

// Define the logs router with procedure definitions
// The actual implementation will be provided by the backend
export const createLogsRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    getLogs: (
      input: z.infer<typeof GetLogsRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof GetLogsResponseSchema>>;
    clearLogs: (
      userId: string,
    ) => Promise<z.infer<typeof ClearLogsResponseSchema>>;
  },
) =>
  router({
    // Protected: Get logs with optional limit. Log entries are global (they
    // carry no owner), so in multi-tenant mode the impl restricts this to
    // administrators.
    get: protectedProcedure
      .input(GetLogsRequestSchema)
      .output(GetLogsResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.getLogs(input, ctx.user.id);
      }),

    // Admin: Clear all logs
    clear: adminProcedure
      .output(ClearLogsResponseSchema)
      .mutation(async ({ ctx }) => {
        return await implementations.clearLogs(ctx.user.id);
      }),
  });
