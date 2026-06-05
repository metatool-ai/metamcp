import {
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  OAuthProxyFetchRequestSchema,
  OAuthProxyFetchResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Define the OAuth router with procedure definitions
// The actual implementation will be provided by the backend
export const createOAuthRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    get: (
      input: z.infer<typeof GetOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof GetOAuthSessionResponseSchema>>;
    upsert: (
      input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>>;
    proxyFetch: (
      input: z.infer<typeof OAuthProxyFetchRequestSchema>,
    ) => Promise<z.infer<typeof OAuthProxyFetchResponseSchema>>;
  },
) => {
  return router({
    // Protected: Get OAuth session by MCP server UUID
    get: protectedProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    // Protected: Upsert OAuth session
    upsert: protectedProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.upsert(input);
      }),

    // Protected: Server-side OAuth fetch proxy (for CORS-less upstream servers)
    proxyFetch: protectedProcedure
      .input(OAuthProxyFetchRequestSchema)
      .output(OAuthProxyFetchResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.proxyFetch(input);
      }),
  });
};
