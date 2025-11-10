import {
  BulkImportMcpServersRequestSchema,
  BulkImportMcpServersResponseSchema,
  CreateMcpServerRequestSchema,
  CreateMcpServerResponseSchema,
  DeleteMcpServerResponseSchema,
  GetMcpServerResponseSchema,
  ListMcpServersResponseSchema,
  UpdateMcpServerRequestSchema,
  UpdateMcpServerResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, router } from "../../trpc";

// Define the MCP servers router with procedure definitions
// The actual implementation will be provided by the backend
export const createMcpServersRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    create: (
      input: z.infer<typeof CreateMcpServerRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof CreateMcpServerResponseSchema>>;
    list: (
      userId: string,
    ) => Promise<z.infer<typeof ListMcpServersResponseSchema>>;
    bulkImport: (
      input: z.infer<typeof BulkImportMcpServersRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof BulkImportMcpServersResponseSchema>>;
    get: (
      input: {
        uuid: string;
      },
      userId: string,
    ) => Promise<z.infer<typeof GetMcpServerResponseSchema>>;
    delete: (
      input: {
        uuid: string;
      },
      userId: string,
    ) => Promise<z.infer<typeof DeleteMcpServerResponseSchema>>;
    update: (
      input: z.infer<typeof UpdateMcpServerRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpdateMcpServerResponseSchema>>;
  },
) => {
  return router({
    // Admin only: List all MCP servers
    list: adminProcedure
      .output(ListMcpServersResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.list(ctx.user.id);
      }),

    // Admin only: Get single MCP server by UUID
    get: adminProcedure
      .input(z.object({ uuid: z.string() }))
      .output(GetMcpServerResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, ctx.user.id);
      }),

    // Admin only: Create MCP server
    create: adminProcedure
      .input(CreateMcpServerRequestSchema)
      .output(CreateMcpServerResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.create(input, ctx.user.id);
      }),

    // Admin only: Bulk import MCP servers
    bulkImport: adminProcedure
      .input(BulkImportMcpServersRequestSchema)
      .output(BulkImportMcpServersResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.bulkImport(input, ctx.user.id);
      }),

    // Admin only: Delete MCP server
    delete: adminProcedure
      .input(z.object({ uuid: z.string() }))
      .output(DeleteMcpServerResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.delete(input, ctx.user.id);
      }),

    // Admin only: Update MCP server
    update: adminProcedure
      .input(UpdateMcpServerRequestSchema)
      .output(UpdateMcpServerResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.update(input, ctx.user.id);
      }),
  });
};
