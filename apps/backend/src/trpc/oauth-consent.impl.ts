import {
  OAuthConsentDecisionSchema,
  OAuthConsentDescription,
  OAuthConsentRedirect,
  OAuthConsentRequestSchema,
} from "@repo/zod-types";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { accessService } from "../lib/access/access.service";
import { activityLog } from "../lib/activity/activity-log.service";
import {
  approveAuthorizationRequest,
  decodeAuthorizationRequest,
  denyAuthorizationRequest,
  validateAuthorizationRequest,
} from "../lib/oauth/authorization-request";

/** Decodes and re-validates a request that came back through the browser. */
async function loadRequest(encoded: string) {
  const params = decodeAuthorizationRequest(encoded);
  const validated = params
    ? await validateAuthorizationRequest(params)
    : ({
        ok: false,
        error: "invalid_request",
        error_description: "Malformed authorization request",
      } as const);
  if (!validated.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: validated.error_description,
    });
  }
  return validated;
}

export const oauthConsentImplementations = {
  describe: async (
    input: z.infer<typeof OAuthConsentRequestSchema>,
    _userId: string,
  ): Promise<OAuthConsentDescription> => {
    const { request, client } = await loadRequest(input.request);
    return {
      clientId: client.client_id,
      clientName: client.client_name,
      clientUri: client.client_uri,
      redirectUri: request.redirect_uri,
      redirectOrigin: new URL(request.redirect_uri).origin,
      scope: request.scope,
      registeredAt: client.created_at.toISOString(),
    };
  },

  decide: async (
    input: z.infer<typeof OAuthConsentDecisionSchema>,
    userId: string,
  ): Promise<OAuthConsentRedirect> => {
    const { request, client } = await loadRequest(input.request);
    // protectedProcedure resolved an enabled principal; re-check so a code
    // is never issued for an account disabled in the meantime.
    const principal = await accessService.getPrincipal(userId);
    if (!principal) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This account is disabled.",
      });
    }
    const target = {
      type: "oauth_client",
      id: client.client_id,
      label: client.client_name,
    };
    const details = { redirect_origin: new URL(request.redirect_uri).origin };
    if (!input.approve) {
      await activityLog.record({
        actor: principal,
        action: "oauth.client_denied",
        target,
        details,
      });
      return { redirectUrl: denyAuthorizationRequest(request) };
    }
    const redirectUrl = await approveAuthorizationRequest(request, userId);
    await activityLog.record({
      actor: principal,
      action: "oauth.client_authorized",
      target,
      details: { ...details, scope: request.scope },
    });
    return { redirectUrl };
  },
};
