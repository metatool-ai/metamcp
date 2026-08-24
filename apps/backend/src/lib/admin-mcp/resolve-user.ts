import { db } from "../../db/index";
import { ApiKeysRepository } from "../../db/repositories/api-keys.repo";
import { usersTable } from "../../db/schema";

const apiKeysRepository = new ApiKeysRepository();

export async function resolveUserIdFromApiKey(key: string): Promise<string> {
  const validation = await apiKeysRepository.validateApiKey(key);

  if (!validation.valid) {
    throw new Error("Invalid or inactive API key");
  }

  if (validation.user_id) {
    return validation.user_id;
  }

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .limit(1);

  if (!user) {
    throw new Error(
      "Public API key requires at least one user in the database. Bootstrap a user first.",
    );
  }

  return user.id;
}
