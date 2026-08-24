import {
  CreateToolRequestSchema,
  GetToolsByMcpServerUuidRequestSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createToolsRouter = <
  TImplementations extends {
    getByMcpServerUuid: (input: any) => Promise<any>;
    create: (input: any) => Promise<any>;
    sync: (input: any) => Promise<any>;
  },
>(
  implementations: TImplementations,
) => {
  return router({
    // Protected: Get tools by MCP server UUID
    getByMcpServerUuid: protectedProcedure
      .input(GetToolsByMcpServerUuidRequestSchema)
      .query(async ({ input }) => {
        return implementations.getByMcpServerUuid(input);
      }),

    // Protected: Save tools to database (upsert only, no cleanup)
    create: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input }) => {
        return implementations.create(input);
      }),

    // Protected: Sync tools with cleanup (removes obsolete tools)
    sync: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input }) => {
        return implementations.sync(input);
      }),
  });
};
