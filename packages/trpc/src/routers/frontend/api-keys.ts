import {
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  DeleteApiKeyRequestSchema,
  DeleteApiKeyResponseSchema,
  ListApiKeysResponseSchema,
  UpdateApiKeyRequestSchema,
  UpdateApiKeyResponseSchema,
  ValidateApiKeyRequestSchema,
  ValidateApiKeyResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

export const createApiKeysRouter = (implementations: {
  create: (
    input: z.infer<typeof CreateApiKeyRequestSchema>,
    userId: string,
  ) => Promise<z.infer<typeof CreateApiKeyResponseSchema>>;
  list: (userId: string) => Promise<z.infer<typeof ListApiKeysResponseSchema>>;
  update: (
    input: z.infer<typeof UpdateApiKeyRequestSchema>,
    userId: string,
  ) => Promise<z.infer<typeof UpdateApiKeyResponseSchema>>;
  delete: (
    input: z.infer<typeof DeleteApiKeyRequestSchema>,
    userId: string,
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
        return implementations.create(input, ctx.user.id);
      }),

    list: protectedProcedure
      .output(ListApiKeysResponseSchema)
      .query(async ({ ctx }) => {
        return implementations.list(ctx.user.id);
      }),

    update: protectedProcedure
      .input(UpdateApiKeyRequestSchema)
      .output(UpdateApiKeyResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.update(input, ctx.user.id);
      }),

    delete: protectedProcedure
      .input(DeleteApiKeyRequestSchema)
      .output(DeleteApiKeyResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return implementations.delete(input, ctx.user.id);
      }),

    validate: protectedProcedure
      .input(ValidateApiKeyRequestSchema)
      .output(ValidateApiKeyResponseSchema)
      .query(async ({ input }) => {
        return implementations.validate(input);
      }),
  });
};
