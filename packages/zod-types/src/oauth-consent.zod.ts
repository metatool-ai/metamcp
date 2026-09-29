import { z } from "zod";

// Consent step of the MetaMCP OAuth server: the signed-in user approves or
// refuses an authorization request before any code is issued.

/** Opaque authorization request, as carried by the consent page URL. */
export const OAuthConsentRequestSchema = z.object({
  request: z.string().min(1).max(16384),
});

export const OAuthConsentDescriptionSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  clientUri: z.string().nullable(),
  redirectUri: z.string(),
  /** Where the code is sent: shown prominently to the user. */
  redirectOrigin: z.string(),
  scope: z.string(),
  registeredAt: z.string(),
});
export type OAuthConsentDescription = z.infer<
  typeof OAuthConsentDescriptionSchema
>;

export const OAuthConsentDecisionSchema = OAuthConsentRequestSchema.extend({
  approve: z.boolean(),
});

export const OAuthConsentRedirectSchema = z.object({
  redirectUrl: z.string(),
});
export type OAuthConsentRedirect = z.infer<typeof OAuthConsentRedirectSchema>;
