import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";

import { resolveUserIdFromApiKey } from "./resolve-user";

export async function resolveAdminUserIdFromRequest(
  authReq: ApiKeyAuthenticatedRequest,
  token?: string,
): Promise<string | undefined> {
  if (authReq.oauthUserId) {
    return authReq.oauthUserId;
  }

  if (authReq.apiKeyUserId) {
    return authReq.apiKeyUserId;
  }

  if (token) {
    return resolveUserIdFromApiKey(token);
  }

  return undefined;
}
