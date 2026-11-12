import type { DatabaseEndpoint } from "@repo/zod-types";

import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";
import logger from "@/utils/logger";

import type { AdminToolsOptions } from "../metamcp/metamcp-server-pool";
import { resolveAdminUserIdFromRequest } from "./resolve-auth-user";

function extractAuthToken(req: ApiKeyAuthenticatedRequest): string | undefined {
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  return undefined;
}

export async function buildAdminToolsOptions(
  endpoint: DatabaseEndpoint,
  authReq: ApiKeyAuthenticatedRequest,
): Promise<AdminToolsOptions | undefined> {
  if (!endpoint.enable_metamcp_admin_tools) {
    return undefined;
  }

  if (!endpoint.enable_api_key_auth && !endpoint.enable_oauth) {
    return undefined;
  }

  let userId: string | undefined;
  try {
    userId = await resolveAdminUserIdFromRequest(
      authReq,
      extractAuthToken(authReq),
    );
  } catch (error) {
    // e.g. a public (user-less) API key: admin tools are simply not exposed
    // on this session; the regular endpoint keeps working.
    logger.warn(
      `MetaMCP admin tools disabled for this session: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }

  if (!userId) {
    return undefined;
  }

  return {
    enabled: true,
    userId,
  };
}
