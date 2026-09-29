import {
  OAuthConsentDecisionSchema,
  type OAuthConsentDescription,
  OAuthConsentDescriptionSchema,
  type OAuthConsentRedirect,
  OAuthConsentRedirectSchema,
  OAuthConsentRequestSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { protectedProcedure, router } from "../../trpc";

// Consent page of the MetaMCP OAuth server. Mutations are POST requests with
// a JSON body, which a cross-site page cannot forge with the user's cookies.
export const createOAuthConsentRouter = (implementations: {
  describe: (
    input: z.infer<typeof OAuthConsentRequestSchema>,
    userId: string,
  ) => Promise<OAuthConsentDescription>;
  decide: (
    input: z.infer<typeof OAuthConsentDecisionSchema>,
    userId: string,
  ) => Promise<OAuthConsentRedirect>;
}) =>
  router({
    describe: protectedProcedure
      .input(OAuthConsentRequestSchema)
      .output(OAuthConsentDescriptionSchema)
      .query(async ({ input, ctx }) => {
        return await implementations.describe(input, ctx.principal.userId);
      }),
    decide: protectedProcedure
      .input(OAuthConsentDecisionSchema)
      .output(OAuthConsentRedirectSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.decide(input, ctx.principal.userId);
      }),
  });
