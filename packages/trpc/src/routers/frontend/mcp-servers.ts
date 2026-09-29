import {
  type AccessPrincipal,
  BulkImportMcpServersRequestSchema,
  BulkImportMcpServersResponseSchema,
  CreateMcpServerRequestSchema,
  CreateMcpServerResponseSchema,
  DeleteMcpServerResponseSchema,
  GetMcpServerResponseSchema,
  type ListMcpServersRequest,
  ListMcpServersRequestSchema,
  ListMcpServersResponseSchema,
  UpdateMcpServerRequestSchema,
  UpdateMcpServerResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Define the MCP servers router with procedure definitions
// The actual implementation will be provided by the backend
export const createMcpServersRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    create: (
      input: z.infer<typeof CreateMcpServerRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof CreateMcpServerResponseSchema>>;
    list: (
      principal: AccessPrincipal,
      input?: ListMcpServersRequest,
    ) => Promise<z.infer<typeof ListMcpServersResponseSchema>>;
    bulkImport: (
      input: z.infer<typeof BulkImportMcpServersRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof BulkImportMcpServersResponseSchema>>;
    get: (
      input: {
        uuid: string;
      },
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof GetMcpServerResponseSchema>>;
    delete: (
      input: {
        uuid: string;
      },
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof DeleteMcpServerResponseSchema>>;
    update: (
      input: z.infer<typeof UpdateMcpServerRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof UpdateMcpServerResponseSchema>>;
  },
) => {
  return router({
    // Protected: List all MCP servers
    list: protectedProcedure
      .input(ListMcpServersRequestSchema)
      .output(ListMcpServersResponseSchema)
      .query(async ({ ctx, input }) => {
        return await implementations.list(ctx.principal, input);
      }),

    // Protected: Get single MCP server by UUID
    get: protectedProcedure
      .input(z.object({ uuid: z.string() }))
      .output(GetMcpServerResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, ctx.principal);
      }),

    // Protected: Create MCP server
    create: protectedProcedure
      .input(CreateMcpServerRequestSchema)
      .output(CreateMcpServerResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.create(input, ctx.principal);
      }),

    // Protected: Bulk import MCP servers
    bulkImport: protectedProcedure
      .input(BulkImportMcpServersRequestSchema)
      .output(BulkImportMcpServersResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.bulkImport(input, ctx.principal);
      }),

    // Protected: Delete MCP server
    delete: protectedProcedure
      .input(z.object({ uuid: z.string() }))
      .output(DeleteMcpServerResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.delete(input, ctx.principal);
      }),

    // Protected: Update MCP server
    update: protectedProcedure
      .input(UpdateMcpServerRequestSchema)
      .output(UpdateMcpServerResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.update(input, ctx.principal);
      }),
  });
};
