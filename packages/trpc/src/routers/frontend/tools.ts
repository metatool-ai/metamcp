import {
  CreateToolRequestSchema,
  GetToolsByMcpServerUuidRequestSchema,
  UpdateToolAnnotationsRequestSchema,
  UpdateToolAnnotationsResponseSchema,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createToolsRouter = <
  TImplementations extends {
    getByMcpServerUuid: (input: any) => Promise<any>;
    create: (input: any) => Promise<any>;
    updateAnnotations: (input: any) => Promise<any>;
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

    // Protected: Save tools to database
    create: protectedProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input }) => {
        return implementations.create(input);
      }),

    // Protected: Update tool annotations (MCP 2025-06-18 spec)
    updateAnnotations: protectedProcedure
      .input(UpdateToolAnnotationsRequestSchema)
      .output(UpdateToolAnnotationsResponseSchema)
      .mutation(async ({ input }) => {
        return implementations.updateAnnotations(input);
      }),
  });
};
