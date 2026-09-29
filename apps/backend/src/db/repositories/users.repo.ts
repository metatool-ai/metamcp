import type { Role, UserStatus } from "@repo/zod-types";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  max,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "../index";
import {
  accountsTable,
  apiKeysTable,
  endpointsTable,
  groupMembersTable,
  groupsTable,
  mcpServersTable,
  namespacesTable,
  oauthAccessTokensTable,
  oauthAuthorizationCodesTable,
  sessionsTable,
  usersTable,
} from "../schema";

export type DatabaseUser = typeof usersTable.$inferSelect;

export type UserListFilters = {
  search?: string;
  role?: Role;
  status?: UserStatus;
  groupUuid?: string;
  limit: number;
  offset: number;
};

export type UserResourceCounts = {
  mcpServers: number;
  namespaces: number;
  endpoints: number;
  apiKeys: number;
};

/** SQL predicate: the user's effective role (base role or group role) equals `role`. */
function effectiveRoleIs(role: Role): SQL {
  const groupGrants = (target: Role) => sql`EXISTS (
    SELECT 1 FROM ${groupMembersTable} gm
    JOIN ${groupsTable} g ON g.uuid = gm.group_uuid
    WHERE gm.user_id = ${usersTable.id} AND g.role = ${target}
  )`;
  const everyoneGrants = (target: Role) => sql`EXISTS (
    SELECT 1 FROM ${groupsTable} g
    WHERE g.system_key = 'everyone' AND g.role = ${target}
  )`;
  const holds = (target: Role) =>
    sql`(${usersTable.role} = ${target} OR ${groupGrants(target)} OR ${everyoneGrants(target)})`;

  if (role === "admin") return holds("admin");
  if (role === "editor")
    return sql`(${holds("editor")} AND NOT ${holds("admin")})`;
  return sql`(NOT ${holds("editor")} AND NOT ${holds("admin")})`;
}

export class UsersRepository {
  async findById(id: string): Promise<DatabaseUser | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return user;
  }

  async findByIds(ids: string[]): Promise<DatabaseUser[]> {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
  }

  async findByEmail(email: string): Promise<DatabaseUser | undefined> {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${email.trim()})`)
      .limit(1);
    return user;
  }

  async count(): Promise<number> {
    const [row] = await db.select({ value: count() }).from(usersTable);
    return row?.value ?? 0;
  }

  async list(
    filters: UserListFilters,
  ): Promise<{ users: DatabaseUser[]; total: number }> {
    const conditions: SQL[] = [];
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim().replace(/[%_\\]/g, "\\$&")}%`;
      const searchCondition = or(
        ilike(usersTable.name, term),
        ilike(usersTable.email, term),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (filters.status) {
      conditions.push(eq(usersTable.disabled, filters.status === "disabled"));
    }
    if (filters.role) {
      conditions.push(effectiveRoleIs(filters.role));
    }
    if (filters.groupUuid) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${groupMembersTable} gm
        WHERE gm.user_id = ${usersTable.id} AND gm.group_uuid = ${filters.groupUuid}
      )`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [users, [totalRow]] = await Promise.all([
      db
        .select()
        .from(usersTable)
        .where(where)
        .orderBy(asc(usersTable.disabled), desc(usersTable.createdAt))
        .limit(filters.limit)
        .offset(filters.offset),
      db.select({ value: count() }).from(usersTable).where(where),
    ]);
    return { users, total: totalRow?.value ?? 0 };
  }

  /** Sign-in methods per user: "credential" (email/password) or the OIDC provider id. */
  async getAuthMethods(userIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (userIds.length === 0) return result;
    const rows = await db
      .selectDistinct({
        userId: accountsTable.userId,
        providerId: accountsTable.providerId,
      })
      .from(accountsTable)
      .where(inArray(accountsTable.userId, userIds));
    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push(row.providerId);
      result.set(row.userId, list);
    }
    return result;
  }

  async getLastSeen(userIds: string[]): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    if (userIds.length === 0) return result;
    const rows = await db
      .select({
        userId: sessionsTable.userId,
        lastSeen: max(sessionsTable.updatedAt),
      })
      .from(sessionsTable)
      .where(inArray(sessionsTable.userId, userIds))
      .groupBy(sessionsTable.userId);
    for (const row of rows) {
      if (row.lastSeen) result.set(row.userId, row.lastSeen);
    }
    return result;
  }

  async getResourceCounts(
    userIds: string[],
  ): Promise<Map<string, UserResourceCounts>> {
    const result = new Map<string, UserResourceCounts>();
    if (userIds.length === 0) return result;
    for (const id of userIds) {
      result.set(id, {
        mcpServers: 0,
        namespaces: 0,
        endpoints: 0,
        apiKeys: 0,
      });
    }

    const tally = async (
      table:
        | typeof mcpServersTable
        | typeof namespacesTable
        | typeof endpointsTable
        | typeof apiKeysTable,
      key: keyof UserResourceCounts,
    ) => {
      const rows = await db
        .select({ userId: table.user_id, value: count() })
        .from(table)
        .where(inArray(table.user_id, userIds))
        .groupBy(table.user_id);
      for (const row of rows) {
        if (!row.userId) continue;
        const entry = result.get(row.userId);
        if (entry) entry[key] = row.value;
      }
    };

    await Promise.all([
      tally(mcpServersTable, "mcpServers"),
      tally(namespacesTable, "namespaces"),
      tally(endpointsTable, "endpoints"),
      tally(apiKeysTable, "apiKeys"),
    ]);
    return result;
  }

  async update(
    id: string,
    patch: { name?: string; role?: Role },
  ): Promise<DatabaseUser | undefined> {
    const [user] = await db
      .update(usersTable)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.role !== undefined && { role: patch.role }),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, id))
      .returning();
    return user;
  }

  async setRole(id: string, role: Role): Promise<void> {
    await db
      .update(usersTable)
      .set({ role, updatedAt: new Date() })
      .where(eq(usersTable.id, id));
  }

  async setExternalGroups(id: string, groups: string[]): Promise<void> {
    await db
      .update(usersTable)
      .set({ externalGroups: groups, externalGroupsSyncedAt: new Date() })
      .where(eq(usersTable.id, id));
  }

  /**
   * Disables or re-enables a user. Disabling also revokes every credential:
   * web sessions and MetaMCP OAuth tokens/codes (API keys are rejected at
   * validation time while the owner is disabled, so they come back if the
   * user is re-enabled).
   */
  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({
          disabled,
          disabledAt: disabled ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, id));
      if (disabled) {
        await tx.delete(sessionsTable).where(eq(sessionsTable.userId, id));
        await tx
          .delete(oauthAccessTokensTable)
          .where(eq(oauthAccessTokensTable.user_id, id));
        await tx
          .delete(oauthAuthorizationCodesTable)
          .where(eq(oauthAuthorizationCodesTable.user_id, id));
      }
    });
  }

  /**
   * Signs the user out everywhere: web sessions, and the MetaMCP OAuth
   * tokens and codes issued from them to MCP clients. API keys are separate
   * credentials, managed (and revoked) on their own.
   */
  async revokeSessions(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(sessionsTable).where(eq(sessionsTable.userId, id));
      await tx
        .delete(oauthAccessTokensTable)
        .where(eq(oauthAccessTokensTable.user_id, id));
      await tx
        .delete(oauthAuthorizationCodesTable)
        .where(eq(oauthAuthorizationCodesTable.user_id, id));
    });
  }

  /**
   * Names of resources that would collide with the target scope's unique
   * (name, user_id) constraints if `fromUserId`'s resources were moved there.
   */
  async findTransferConflicts(
    fromUserId: string,
    toUserId: string | null,
  ): Promise<{ mcpServers: string[]; namespaces: string[] }> {
    const targetOwner =
      toUserId === null ? sql`t.user_id IS NULL` : sql`t.user_id = ${toUserId}`;
    const [servers, namespaces] = await Promise.all([
      db.execute<{ name: string }>(sql`
        SELECT s.name FROM ${mcpServersTable} s
        WHERE s.user_id = ${fromUserId}
          AND EXISTS (SELECT 1 FROM ${mcpServersTable} t WHERE t.name = s.name AND ${targetOwner})
      `),
      db.execute<{ name: string }>(sql`
        SELECT n.name FROM ${namespacesTable} n
        WHERE n.user_id = ${fromUserId}
          AND EXISTS (SELECT 1 FROM ${namespacesTable} t WHERE t.name = n.name AND ${targetOwner})
      `),
    ]);
    return {
      mcpServers: servers.rows.map((row) => row.name),
      namespaces: namespaces.rows.map((row) => row.name),
    };
  }

  /**
   * Deletes a user. Owned MCP servers, namespaces and endpoints are either
   * deleted (cascade) or moved to another owner / the organisation first.
   * API keys, sessions, memberships and direct shares are always removed.
   */
  async deleteWithTransfer(
    id: string,
    transferTo: { mode: "delete" } | { mode: "owner"; ownerId: string | null },
  ): Promise<void> {
    await db.transaction(async (tx) => {
      if (transferTo.mode === "owner") {
        const ownerId = transferTo.ownerId;
        await tx
          .update(mcpServersTable)
          .set({ user_id: ownerId })
          .where(eq(mcpServersTable.user_id, id));
        await tx
          .update(namespacesTable)
          .set({ user_id: ownerId, updated_at: new Date() })
          .where(eq(namespacesTable.user_id, id));
        await tx
          .update(endpointsTable)
          .set({ user_id: ownerId, updated_at: new Date() })
          .where(eq(endpointsTable.user_id, id));
      }
      await tx.delete(usersTable).where(eq(usersTable.id, id));
    });
  }

  /** Candidates for the sharing picker (active users only). */
  async searchActive(
    query: string,
    limit: number,
    excludeIds: string[] = [],
  ): Promise<DatabaseUser[]> {
    const conditions: SQL[] = [eq(usersTable.disabled, false)];
    if (query.trim()) {
      const term = `%${query.trim().replace(/[%_\\]/g, "\\$&")}%`;
      const searchCondition = or(
        ilike(usersTable.name, term),
        ilike(usersTable.email, term),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    for (const excluded of excludeIds) {
      conditions.push(ne(usersTable.id, excluded));
    }
    return await db
      .select()
      .from(usersTable)
      .where(and(...conditions))
      .orderBy(asc(sql`lower(${usersTable.name})`))
      .limit(limit);
  }
}

export const usersRepository = new UsersRepository();
