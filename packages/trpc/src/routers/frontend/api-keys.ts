import {
  type AccessPrincipal,
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  DeleteApiKeyRequestSchema,
  DeleteApiKeyResponseSchema,
  type ListApiKeysRequest,
  ListApiKeysRequestSchema,
  ListApiKeysResponseSchema,
  UpdateApiKeyRequestSchema,
  UpdateApiKeyResponseSchema,
  ValidateApiKeyRequestSchema,
  ValidateApiKeyResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, protectedProcedure, router } from "../../trpc";

export const createApiKeysRouter = (implementations: {
  create: (
    input: z.infer<typeof CreateApiKeyRequestSchema>,
    principal: AccessPrincipal,
  ) => Promise<z.infer<typeof CreateApiKeyResponseSchema>>;
  list: (
    principal: AccessPrincipal,
    input?: ListApiKeysRequest,
  ) => Promise<z.infer<typeof ListApiKeysResponseSchema>>;
  update: (
    input: z.infer<typeof UpdateApiKeyRequestSchema>,
    principal: AccessPrincipal,
  ) => Promise<z.infer<typeof UpdateApiKeyResponseSchema>>;
  delete: (
    input: z.infer<typeof DeleteApiKeyRequestSchema>,
    principal: AccessPrincipal,
  ) => Promise<z.infer<typeof DeleteApiKeyResponseSchema>>;
  validate: (
    input: z.infer<typeof ValidateApiKeyRequestSchema>,
  ) => Promise<z.infer<typeof ValidateApiKeyResponseSchema>>;
}) => {
  return router({
    create: protectedProcedure
      .input(CreateApiKeyRequestSchema)
      .output(CreateApiKeyResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.create(input, ctx.principal);
      }),

    list: protectedProcedure
      .input(ListApiKeysRequestSchema)
      .output(ListApiKeysResponseSchema)
      .query(async ({ ctx, input }) => {
        return implementations.list(ctx.principal, input);
      }),

    update: protectedProcedure
      .input(UpdateApiKeyRequestSchema)
      .output(UpdateApiKeyResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.update(input, ctx.principal);
      }),

    delete: protectedProcedure
      .input(DeleteApiKeyRequestSchema)
      .output(DeleteApiKeyResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.delete(input, ctx.principal);
      }),

    // Admin only: maps any key string to its owner.
    validate: adminProcedure
      .input(ValidateApiKeyRequestSchema)
      .output(ValidateApiKeyResponseSchema)
      .query(async ({ input }) => {
        return implementations.validate(input);
      }),
  });
};
