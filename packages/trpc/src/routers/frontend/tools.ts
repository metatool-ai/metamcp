import {
  CreateToolRequestSchema,
  GetToolsByMcpServerUuidRequestSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createToolsRouter = <
  TImplementations extends {
    getByMcpServerUuid: (input: any, userId: string) => Promise<any>;
    create: (input: any, userId: string) => Promise<any>;
    sync: (input: any, userId: string) => Promise<any>;
  },
>(
  implementations: TImplementations,
) => {
  return router({
    // Protected: Get tools by MCP server UUID
    getByMcpServerUuid: protectedProcedure
      .input(GetToolsByMcpServerUuidRequestSchema)
      .query(async ({ input, ctx }) => {
        return implementations.getByMcpServerUuid(input, ctx.user.id);
      }),

    // Protected: Save tools to database (upsert only, no cleanup)
    create: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.create(input, ctx.user.id);
      }),

    // Protected: Sync tools with cleanup (removes obsolete tools)
    sync: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.sync(input, ctx.user.id);
      }),
  });
};
