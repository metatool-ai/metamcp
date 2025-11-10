import {
  CreateNamespaceRequestSchema,
  CreateNamespaceResponseSchema,
  DeleteNamespaceResponseSchema,
  GetNamespaceResponseSchema,
  GetNamespaceToolsRequestSchema,
  GetNamespaceToolsResponseSchema,
  ListNamespacesResponseSchema,
  RefreshNamespaceToolsRequestSchema,
  RefreshNamespaceToolsResponseSchema,
  UpdateNamespaceRequestSchema,
  UpdateNamespaceResponseSchema,
  UpdateNamespaceServerStatusRequestSchema,
  UpdateNamespaceServerStatusResponseSchema,
  UpdateNamespaceToolOverridesRequestSchema,
  UpdateNamespaceToolOverridesResponseSchema,
  UpdateNamespaceToolStatusRequestSchema,
  UpdateNamespaceToolStatusResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, router } from "../../trpc";

// Define the namespaces router with procedure definitions
// The actual implementation will be provided by the backend
export const createNamespacesRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    create: (
      input: z.infer<typeof CreateNamespaceRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof CreateNamespaceResponseSchema>>;
    list: (
      userId: string,
    ) => Promise<z.infer<typeof ListNamespacesResponseSchema>>;
    get: (
      input: {
        uuid: string;
      },
      userId: string,
    ) => Promise<z.infer<typeof GetNamespaceResponseSchema>>;
    getTools: (
      input: z.infer<typeof GetNamespaceToolsRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof GetNamespaceToolsResponseSchema>>;
    delete: (
      input: {
        uuid: string;
      },
      userId: string,
    ) => Promise<z.infer<typeof DeleteNamespaceResponseSchema>>;
    update: (
      input: z.infer<typeof UpdateNamespaceRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpdateNamespaceResponseSchema>>;
    updateServerStatus: (
      input: z.infer<typeof UpdateNamespaceServerStatusRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpdateNamespaceServerStatusResponseSchema>>;
    updateToolStatus: (
      input: z.infer<typeof UpdateNamespaceToolStatusRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpdateNamespaceToolStatusResponseSchema>>;
    updateToolOverrides: (
      input: z.infer<typeof UpdateNamespaceToolOverridesRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpdateNamespaceToolOverridesResponseSchema>>;
    refreshTools: (
      input: z.infer<typeof RefreshNamespaceToolsRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof RefreshNamespaceToolsResponseSchema>>;
  },
) => {
  return router({
    // Admin only: List all namespaces
    list: adminProcedure
      .output(ListNamespacesResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.list(ctx.user.id);
      }),

    // Admin only: Get single namespace by UUID
    get: adminProcedure
      .input(z.object({ uuid: z.string() }))
      .output(GetNamespaceResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, ctx.user.id);
      }),

    // Admin only: Get tools for namespace from mapping table
    getTools: adminProcedure
      .input(GetNamespaceToolsRequestSchema)
      .output(GetNamespaceToolsResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.getTools(input, ctx.user.id);
      }),

    // Admin only: Create namespace
    create: adminProcedure
      .input(CreateNamespaceRequestSchema)
      .output(CreateNamespaceResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.create(input, ctx.user.id);
      }),

    // Admin only: Delete namespace
    delete: adminProcedure
      .input(z.object({ uuid: z.string() }))
      .output(DeleteNamespaceResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.delete(input, ctx.user.id);
      }),

    // Admin only: Update namespace
    update: adminProcedure
      .input(UpdateNamespaceRequestSchema)
      .output(UpdateNamespaceResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.update(input, ctx.user.id);
      }),

    // Admin only: Update server status within namespace
    updateServerStatus: adminProcedure
      .input(UpdateNamespaceServerStatusRequestSchema)
      .output(UpdateNamespaceServerStatusResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.updateServerStatus(input, ctx.user.id);
      }),

    // Admin only: Update tool status within namespace
    updateToolStatus: adminProcedure
      .input(UpdateNamespaceToolStatusRequestSchema)
      .output(UpdateNamespaceToolStatusResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.updateToolStatus(input, ctx.user.id);
      }),

    // Admin only: Update tool overrides within namespace
    updateToolOverrides: adminProcedure
      .input(UpdateNamespaceToolOverridesRequestSchema)
      .output(UpdateNamespaceToolOverridesResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.updateToolOverrides(input, ctx.user.id);
      }),

    // Admin only: Refresh tools from MetaMCP connection
    refreshTools: adminProcedure
      .input(RefreshNamespaceToolsRequestSchema)
      .output(RefreshNamespaceToolsResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.refreshTools(input, ctx.user.id);
      }),
  });
};
