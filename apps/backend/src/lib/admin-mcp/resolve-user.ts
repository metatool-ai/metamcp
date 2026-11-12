import { ApiKeysRepository } from "../../db/repositories/api-keys.repo";

const apiKeysRepository = new ApiKeysRepository();

export async function resolveUserIdFromApiKey(key: string): Promise<string> {
  const validation = await apiKeysRepository.validateApiKey(key);

  if (!validation.valid) {
    throw new Error("Invalid or inactive API key");
  }

  // SECURITY: a public API key (user_id = null) is not bound to any user, so
  // it cannot act as one. Never fall back to an arbitrary user (previously
  // the first row of the users table), which would hand every holder of a
  // public key that user's — often the administrator's — privileges.
  if (!validation.user_id) {
    throw new Error(
      "Public API keys cannot be used for MetaMCP admin tools. Use an API key owned by a user.",
    );
  }

  return validation.user_id;
}
