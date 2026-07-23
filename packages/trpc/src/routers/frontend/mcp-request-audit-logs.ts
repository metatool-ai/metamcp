import {
  ListMcpRequestAuditLogsRequestSchema,
  ListMcpRequestAuditLogsResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

export const createMcpRequestAuditLogsRouter = (implementations: {
  list: (
    input: z.infer<typeof ListMcpRequestAuditLogsRequestSchema>,
    userId: string,
  ) => Promise<z.infer<typeof ListMcpRequestAuditLogsResponseSchema>>;
}) => {
  return router({
    list: protectedProcedure
      .input(ListMcpRequestAuditLogsRequestSchema)
      .output(ListMcpRequestAuditLogsResponseSchema)
      .query(async ({ input, ctx }) => {
        return implementations.list(input, ctx.user.id);
      }),
  });
};
