import type { ResourceOwner } from "@repo/zod-types";

import { usersRepository } from "../../db/repositories/users.repo";

/** Display information about resource owners, keyed by user id. */
export async function loadOwners(
  ownerIds: readonly (string | null)[],
): Promise<Map<string, ResourceOwner>> {
  const ids = [...new Set(ownerIds.filter((id): id is string => Boolean(id)))];
  const users = await usersRepository.findByIds(ids);
  return new Map(
    users.map((user) => [
      user.id,
      { id: user.id, name: user.name, email: user.email },
    ]),
  );
}
