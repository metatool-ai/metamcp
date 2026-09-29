import {
  type AccessPrincipal,
  type ListSharesResponse,
  ListSharesResponseSchema,
  RemoveShareRequestSchema,
  ResourceRefSchema,
  SearchShareSubjectsRequestSchema,
  type SearchShareSubjectsResponse,
  SearchShareSubjectsResponseSchema,
  type ShareMutationResponse,
  ShareMutationResponseSchema,
  UpsertShareRequestSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Sharing of MCP servers and namespaces with users and groups. Permission
// checks (manage level + "resources.share" capability) live in the backend.
export const createSharesRouter = (implementations: {
  list: (
    input: z.infer<typeof ResourceRefSchema>,
    principal: AccessPrincipal,
  ) => Promise<ListSharesResponse | null>;
  upsert: (
    input: z.infer<typeof UpsertShareRequestSchema>,
    principal: AccessPrincipal,
  ) => Promise<ShareMutationResponse>;
  remove: (
    input: z.infer<typeof RemoveShareRequestSchema>,
    principal: AccessPrincipal,
  ) => Promise<ShareMutationResponse>;
  searchSubjects: (
    input: z.infer<typeof SearchShareSubjectsRequestSchema>,
    principal: AccessPrincipal,
  ) => Promise<SearchShareSubjectsResponse>;
}) =>
  router({
    list: protectedProcedure
      .input(ResourceRefSchema)
      .output(ListSharesResponseSchema.nullable())
      .query(({ input, ctx }) => implementations.list(input, ctx.principal)),
    upsert: protectedProcedure
      .input(UpsertShareRequestSchema)
      .output(ShareMutationResponseSchema)
      .mutation(({ input, ctx }) =>
        implementations.upsert(input, ctx.principal),
      ),
    remove: protectedProcedure
      .input(RemoveShareRequestSchema)
      .output(ShareMutationResponseSchema)
      .mutation(({ input, ctx }) =>
        implementations.remove(input, ctx.principal),
      ),
    searchSubjects: protectedProcedure
      .input(SearchShareSubjectsRequestSchema)
      .output(SearchShareSubjectsResponseSchema)
      .query(({ input, ctx }) =>
        implementations.searchSubjects(input, ctx.principal),
      ),
  });
