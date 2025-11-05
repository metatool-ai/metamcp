import {
  CreateEndpointRequestSchema,
  CreateEndpointResponseSchema,
  DeleteEndpointResponseSchema,
  GetEndpointResponseSchema,
  ListEndpointsResponseSchema,
  UpdateEndpointRequestSchema,
  UpdateEndpointResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, router } from "../../trpc";

// Define the endpoints router with procedure definitions
// The actual implementation will be provided by the backend
export const createEndpointsRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    create: (
      input: z.infer<typeof CreateEndpointRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof CreateEndpointResponseSchema>>;
    list: (
      userId: string,
    ) => Promise<z.infer<typeof ListEndpointsResponseSchema>>;
    get: (
      input: {
        uuid: string;
      },
      userId: string,
    ) => Promise<z.infer<typeof GetEndpointResponseSchema>>;
    delete: (
      input: {
        uuid: string;
      },
      userId: string,
    ) => Promise<z.infer<typeof DeleteEndpointResponseSchema>>;
    update: (
      input: z.infer<typeof UpdateEndpointRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof UpdateEndpointResponseSchema>>;
  },
) => {
  return router({
    // Admin only: List all endpoints
    list: adminProcedure
      .output(ListEndpointsResponseSchema)
      .query(async ({ ctx }) => {
        return await implementations.list(ctx.user.id);
      }),

    // Admin only: Get single endpoint by UUID
    get: adminProcedure
      .input(z.object({ uuid: z.string() }))
      .output(GetEndpointResponseSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.get(input, ctx.user.id);
      }),

    // Admin only: Create endpoint
    create: adminProcedure
      .input(CreateEndpointRequestSchema)
      .output(CreateEndpointResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.create(input, ctx.user.id);
      }),

    // Admin only: Delete endpoint
    delete: adminProcedure
      .input(z.object({ uuid: z.string() }))
      .output(DeleteEndpointResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.delete(input, ctx.user.id);
      }),

    // Admin only: Update endpoint
    update: adminProcedure
      .input(UpdateEndpointRequestSchema)
      .output(UpdateEndpointResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.update(input, ctx.user.id);
      }),
  });
};
