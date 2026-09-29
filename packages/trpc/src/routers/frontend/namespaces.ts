import {
  type AccessPrincipal,
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

import { protectedProcedure, router } from "../../trpc";

// Define the namespaces router with procedure definitions
// The actual implementation will be provided by the backend
export const createNamespacesRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    create: (
      input: z.infer<typeof CreateNamespaceRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof CreateNamespaceResponseSchema>>;
    list: (
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof ListNamespacesResponseSchema>>;
    get: (
      input: {
        uuid: string;
      },
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof GetNamespaceResponseSchema>>;
    getTools: (
      input: z.infer<typeof GetNamespaceToolsRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof GetNamespaceToolsResponseSchema>>;
    delete: (
      input: {
        uuid: string;
      },
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof DeleteNamespaceResponseSchema>>;
    update: (
      input: z.infer<typeof UpdateNamespaceRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof UpdateNamespaceResponseSchema>>;
    updateServerStatus: (
      input: z.infer<typeof UpdateNamespaceServerStatusRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof UpdateNamespaceServerStatusResponseSchema>>;
    updateToolStatus: (
      input: z.infer<typeof UpdateNamespaceToolStatusRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof UpdateNamespaceToolStatusResponseSchema>>;
    updateToolOverrides: (
      input: z.infer<typeof UpdateNamespaceToolOverridesRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof UpdateNamespaceToolOverridesResponseSchema>>;
    refreshTools: (
      input: z.infer<typeof RefreshNamespaceToolsRequestSchema>,
      principal: AccessPrincipal,
    ) => Promise<z.infer<typeof RefreshNamespaceToolsResponseSchema>>;
  },
) => {
  return router({
    // Protected: List all namespaces
    list: protectedProcedure
      .output(ListNamespacesResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.list(ctx.principal);
      }),

    // Protected: Get single namespace by UUID
    get: protectedProcedure
      .input(z.object({ uuid: z.string() }))
      .output(GetNamespaceResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, ctx.principal);
      }),

    // Protected: Get tools for namespace from mapping table
    getTools: protectedProcedure
      .input(GetNamespaceToolsRequestSchema)
      .output(GetNamespaceToolsResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.getTools(input, ctx.principal);
      }),

    // Protected: Create namespace
    create: protectedProcedure
      .input(CreateNamespaceRequestSchema)
      .output(CreateNamespaceResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.create(input, ctx.principal);
      }),

    // Protected: Delete namespace
    delete: protectedProcedure
      .input(z.object({ uuid: z.string() }))
      .output(DeleteNamespaceResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.delete(input, ctx.principal);
      }),

    // Protected: Update namespace
    update: protectedProcedure
      .input(UpdateNamespaceRequestSchema)
      .output(UpdateNamespaceResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.update(input, ctx.principal);
      }),

    // Protected: Update server status within namespace
    updateServerStatus: protectedProcedure
      .input(UpdateNamespaceServerStatusRequestSchema)
      .output(UpdateNamespaceServerStatusResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.updateServerStatus(input, ctx.principal);
      }),

    // Protected: Update tool status within namespace
    updateToolStatus: protectedProcedure
      .input(UpdateNamespaceToolStatusRequestSchema)
      .output(UpdateNamespaceToolStatusResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.updateToolStatus(input, ctx.principal);
      }),

    // Protected: Update tool overrides within namespace
    updateToolOverrides: protectedProcedure
      .input(UpdateNamespaceToolOverridesRequestSchema)
      .output(UpdateNamespaceToolOverridesResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.updateToolOverrides(input, ctx.principal);
      }),

    // Protected: Refresh tools from MetaMCP connection
    refreshTools: protectedProcedure
      .input(RefreshNamespaceToolsRequestSchema)
      .output(RefreshNamespaceToolsResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.refreshTools(input, ctx.principal);
      }),
  });
};
