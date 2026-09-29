import type { Role } from "@repo/zod-types";
import { eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../db/index";
import { groupMembersTable, groupsTable, usersTable } from "../../db/schema";

/**
 * A pending change that could remove administrator rights. Every admin
 * mutation describes itself with one of these so we can refuse it when it
 * would leave the instance without any active administrator.
 */
export type AdminChange =
  | { kind: "setBaseRole"; userId: string; role: Role }
  | { kind: "disableUser"; userId: string }
  | { kind: "deleteUser"; userId: string }
  | { kind: "removeMembership"; userId: string; groupUuid: string }
  | { kind: "setGroupRole"; groupUuid: string; role: Role | null }
  | { kind: "deleteGroup"; groupUuid: string };

/** Number of active administrators if `change` were applied. */
export async function countAdminsAfter(change: AdminChange): Promise<number> {
  const groups = await db
    .select({ uuid: groupsTable.uuid, role: groupsTable.role })
    .from(groupsTable);

  const adminGroupUuids = new Set(
    groups
      .filter((group) => {
        if (change.kind === "deleteGroup" && change.groupUuid === group.uuid) {
          return false;
        }
        if (change.kind === "setGroupRole" && change.groupUuid === group.uuid) {
          return change.role === "admin";
        }
        return group.role === "admin";
      })
      .map((group) => group.uuid),
  );

  const memberships =
    adminGroupUuids.size > 0
      ? await db
          .select({
            userId: groupMembersTable.user_id,
            groupUuid: groupMembersTable.group_uuid,
          })
          .from(groupMembersTable)
          .where(inArray(groupMembersTable.group_uuid, [...adminGroupUuids]))
      : [];

  const adminByGroup = new Set(
    memberships
      .filter(
        (membership) =>
          !(
            change.kind === "removeMembership" &&
            change.userId === membership.userId &&
            change.groupUuid === membership.groupUuid
          ),
      )
      .map((membership) => membership.userId),
  );

  const candidateIds = [...adminByGroup];
  const users = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      disabled: usersTable.disabled,
    })
    .from(usersTable)
    .where(
      candidateIds.length > 0
        ? or(eq(usersTable.role, "admin"), inArray(usersTable.id, candidateIds))
        : eq(usersTable.role, "admin"),
    );

  return users.filter((user) => {
    if (change.kind === "deleteUser" && change.userId === user.id) return false;
    const disabled =
      user.disabled ||
      (change.kind === "disableUser" && change.userId === user.id);
    if (disabled) return false;
    const baseRole =
      change.kind === "setBaseRole" && change.userId === user.id
        ? change.role
        : user.role;
    return baseRole === "admin" || adminByGroup.has(user.id);
  }).length;
}

export const LAST_ADMIN_MESSAGE =
  "This change would leave MetaMCP without any active administrator. Promote another administrator first.";

/** Returns an error message when the change would remove the last admin. */
export async function checkAdminRemains(
  change: AdminChange,
): Promise<string | null> {
  return (await countAdminsAfter(change)) > 0 ? null : LAST_ADMIN_MESSAGE;
}

/** Serializes the guarded mutations of this process (see below). */
let adminChangeQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs an administrator-affecting mutation (check + write) while holding a
 * database-wide advisory lock, so two concurrent changes (e.g. two admins
 * demoting each other, possibly on different instances) cannot both pass
 * checkAdminRemains and leave the instance without an administrator.
 *
 * Mutations of one process are queued first: each waiter would otherwise
 * hold a pooled connection while the lock holder needs another one for its
 * own queries.
 */
export function guardAdminChange<Args extends unknown[], Result>(
  mutation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return (...args) => {
    const run = adminChangeQueue.then(() =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('metamcp:admin-changes'))`,
        );
        return await mutation(...args);
      }),
    );
    adminChangeQueue = run.catch(() => undefined);
    return run;
  };
}
