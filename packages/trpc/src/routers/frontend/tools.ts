import {
  CreateToolRequestSchema,
  GetToolsByMcpServerUuidRequestSchema,
  UpdateToolAnnotationsRequestSchema,
  UpdateToolAnnotationsResponseSchema,
} from "@repo/zod-types";

import { adminProcedure, router } from "../../trpc";

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
    // Admin only: Get tools by MCP server UUID
    getByMcpServerUuid: adminProcedure
      .input(GetToolsByMcpServerUuidRequestSchema)
      .query(async ({ input }) => {
        return implementations.getByMcpServerUuid(input);
      }),

    // Admin only: Save tools to database
    create: adminProcedure
      .input(CreateToolRequestSchema)
      .mutation(async ({ input }) => {
        return implementations.create(input);
      }),

    // Admin only: Update tool annotations (MCP 2025-06-18 spec)
    updateAnnotations: adminProcedure
      .input(UpdateToolAnnotationsRequestSchema)
      .output(UpdateToolAnnotationsResponseSchema)
      .mutation(async ({ input }) => {
        return implementations.updateAnnotations(input);
      }),
  });
};
