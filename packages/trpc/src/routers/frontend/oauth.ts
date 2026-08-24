import {
  ExchangeOAuthTokenRequestSchema,
  ExchangeOAuthTokenResponseSchema,
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  RefreshOAuthTokenRequestSchema,
  RefreshOAuthTokenResponseSchema,
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
    exchangeToken: (
      input: z.infer<typeof ExchangeOAuthTokenRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof ExchangeOAuthTokenResponseSchema>>;
    refreshToken: (
      input: z.infer<typeof RefreshOAuthTokenRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof RefreshOAuthTokenResponseSchema>>;
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

    // Protected: Server-side authorization-code-to-tokens exchange. This
    // exists because most enterprise OAuth providers don't return CORS
    // headers on their token endpoints, so the browser cannot do the
    // exchange directly. See docs/en/troubleshooting/oauth-troubleshooting.
    //
    // ctx.user.id is forwarded so the impl can enforce ownership on the
    // referenced MCP server (the upstream URL is loaded from that row, not
    // taken from the request, to prevent SSRF).
    exchangeToken: protectedProcedure
      .input(ExchangeOAuthTokenRequestSchema)
      .output(ExchangeOAuthTokenResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.exchangeToken(input, ctx.user.id);
      }),

    // Protected: Server-side refresh-token grant. Same CORS rationale and
    // same ownership-check requirement.
    refreshToken: protectedProcedure
      .input(RefreshOAuthTokenRequestSchema)
      .output(RefreshOAuthTokenResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.refreshToken(input, ctx.user.id);
      }),
  });
};
