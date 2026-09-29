import { ApiKeysRepository } from "../../db/repositories/api-keys.repo";

const apiKeysRepository = new ApiKeysRepository();

/**
 * Owner of an API key, used as the identity of admin tool calls.
 *
 * Organisation keys (user_id NULL) are not tied to anyone, so they cannot run
 * admin tools: they used to fall back to an arbitrary user (often the first
 * administrator), which let anyone holding such a key act as that user.
 */
export async function resolveUserIdFromApiKey(
  key: string,
): Promise<string | undefined> {
  const validation = await apiKeysRepository.validateApiKey(key);

  if (!validation.valid) {
    throw new Error("Invalid or inactive API key");
  }

  // Endpoint-scoped keys never act as their owner for admin tools
  if (validation.scope === "endpoints") {
    return undefined;
  }

  return validation.user_id ?? undefined;
}
