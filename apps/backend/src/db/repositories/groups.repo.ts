import type { MembershipSource, Role, SystemGroupKey } from "@repo/zod-types";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
  groupMembersTable,
  groupsTable,
  resourceSharesTable,
  usersTable,
} from "../schema";

export type DatabaseGroup = typeof groupsTable.$inferSelect;

export type GroupWithCounts = DatabaseGroup & {
  memberCount: number;
  shareCount: number;
};

export type UserMembership = {
  groupUuid: string;
  name: string;
  role: Role | null;
  systemKey: SystemGroupKey | null;
  source: MembershipSource;
};

export type GroupMemberRow = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  baseRole: Role;
  disabled: boolean;
  source: MembershipSource;
  addedAt: Date;
};

function asSystemKey(value: string | null): SystemGroupKey | null {
  return value === "admins" || value === "everyone" ? value : null;
}

export class GroupsRepository {
  async list(): Promise<GroupWithCounts[]> {
    const groups = await db
      .select()
      .from(groupsTable)
      .orderBy(
        // System groups first, then alphabetical.
        sql`${groupsTable.system_key} IS NULL`,
        asc(sql`lower(${groupsTable.name})`),
      );
    if (groups.length === 0) return [];

    const uuids = groups.map((group) => group.uuid);
    const [memberCounts, shareCounts] = await Promise.all([
      db
        .select({ uuid: groupMembersTable.group_uuid, value: count() })
        .from(groupMembersTable)
        .where(inArray(groupMembersTable.group_uuid, uuids))
        .groupBy(groupMembersTable.group_uuid),
      db
        .select({ uuid: resourceSharesTable.group_uuid, value: count() })
        .from(resourceSharesTable)
        .where(inArray(resourceSharesTable.group_uuid, uuids))
        .groupBy(resourceSharesTable.group_uuid),
    ]);
    const members = new Map(memberCounts.map((row) => [row.uuid, row.value]));
    const shares = new Map(shareCounts.map((row) => [row.uuid, row.value]));

    return groups.map((group) => ({
      ...group,
      memberCount: members.get(group.uuid) ?? 0,
      shareCount: shares.get(group.uuid) ?? 0,
    }));
  }

  async findByUuid(uuid: string): Promise<DatabaseGroup | undefined> {
    const [group] = await db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.uuid, uuid))
      .limit(1);
    return group;
  }

  async findByUuids(uuids: string[]): Promise<DatabaseGroup[]> {
    if (uuids.length === 0) return [];
    return await db
      .select()
      .from(groupsTable)
      .where(inArray(groupsTable.uuid, uuids));
  }

  async findBySystemKey(
    key: SystemGroupKey,
  ): Promise<DatabaseGroup | undefined> {
    const [group] = await db
      .select()
      .from(groupsTable)
      .where(eq(groupsTable.system_key, key))
      .limit(1);
    return group;
  }

  async findByNameInsensitive(
    name: string,
  ): Promise<DatabaseGroup | undefined> {
    const [group] = await db
      .select()
      .from(groupsTable)
      .where(sql`lower(${groupsTable.name}) = lower(${name.trim()})`)
      .limit(1);
    return group;
  }

  /** Groups that have at least one IdP mapping (the only ones SSO sync can touch). */
  async findMapped(): Promise<DatabaseGroup[]> {
    return await db
      .select()
      .from(groupsTable)
      .where(sql`cardinality(${groupsTable.oidc_groups}) > 0`);
  }

  async create(input: {
    name: string;
    description?: string | null;
    role?: Role | null;
    oidcGroups?: string[];
    systemKey?: SystemGroupKey | null;
  }): Promise<DatabaseGroup> {
    const [group] = await db
      .insert(groupsTable)
      .values({
        name: input.name.trim(),
        description: input.description ?? null,
        role: input.role ?? null,
        oidc_groups: input.oidcGroups ?? [],
        system_key: input.systemKey ?? null,
      })
      .returning();
    return group;
  }

  /** Creates the system groups if a migration or seed was skipped. */
  async ensureSystemGroups(): Promise<void> {
    await db
      .insert(groupsTable)
      .values([
        {
          name: "Administrators",
          description:
            "Members are MetaMCP administrators: they manage users, groups, settings and the organisation's resources.",
          role: "admin",
          system_key: "admins",
        },
        {
          name: "Everyone",
          description:
            "Every signed-in user. Share a resource with this group to make it available to the whole organisation.",
          role: null,
          system_key: "everyone",
        },
      ])
      .onConflictDoNothing();
  }

  async update(
    uuid: string,
    patch: {
      name?: string;
      description?: string | null;
      role?: Role | null;
      oidcGroups?: string[];
    },
  ): Promise<DatabaseGroup | undefined> {
    const [group] = await db
      .update(groupsTable)
      .set({
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && {
          description: patch.description,
        }),
        ...(patch.role !== undefined && { role: patch.role }),
        ...(patch.oidcGroups !== undefined && {
          oidc_groups: patch.oidcGroups,
        }),
        updated_at: new Date(),
      })
      .where(eq(groupsTable.uuid, uuid))
      .returning();
    return group;
  }

  async delete(uuid: string): Promise<DatabaseGroup | undefined> {
    const [group] = await db
      .delete(groupsTable)
      .where(eq(groupsTable.uuid, uuid))
      .returning();
    return group;
  }

  async listMembers(groupUuid: string): Promise<GroupMemberRow[]> {
    return await db
      .select({
        userId: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        image: usersTable.image,
        baseRole: usersTable.role,
        disabled: usersTable.disabled,
        source: groupMembersTable.source,
        addedAt: groupMembersTable.created_at,
      })
      .from(groupMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, groupMembersTable.user_id))
      .where(eq(groupMembersTable.group_uuid, groupUuid))
      .orderBy(asc(sql`lower(${usersTable.name})`));
  }

  /**
   * Adds members. Manual additions upgrade existing OIDC memberships to
   * manual (so a later SSO sync won't remove them); OIDC additions never
   * downgrade a manual membership.
   */
  async addMembers(
    groupUuid: string,
    userIds: string[],
    source: MembershipSource,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const rows = [...new Set(userIds)].map((userId) => ({
      group_uuid: groupUuid,
      user_id: userId,
      source,
    }));
    const insert = db.insert(groupMembersTable).values(rows);
    if (source === "manual") {
      await insert.onConflictDoUpdate({
        target: [groupMembersTable.group_uuid, groupMembersTable.user_id],
        set: { source: "manual" },
      });
    } else {
      await insert.onConflictDoNothing();
    }
  }

  async removeMember(groupUuid: string, userId: string): Promise<boolean> {
    const removed = await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.group_uuid, groupUuid),
          eq(groupMembersTable.user_id, userId),
        ),
      )
      .returning({ userId: groupMembersTable.user_id });
    return removed.length > 0;
  }

  async removeMemberships(
    userId: string,
    groupUuids: string[],
    source?: MembershipSource,
  ): Promise<void> {
    if (groupUuids.length === 0) return;
    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.user_id, userId),
          inArray(groupMembersTable.group_uuid, groupUuids),
          ...(source ? [eq(groupMembersTable.source, source)] : []),
        ),
      );
  }

  async getMembershipsForUser(userId: string): Promise<UserMembership[]> {
    const rows = await this.getMembershipsForUsers([userId]);
    return rows.get(userId) ?? [];
  }

  async getMembershipsForUsers(
    userIds: string[],
  ): Promise<Map<string, UserMembership[]>> {
    const result = new Map<string, UserMembership[]>();
    if (userIds.length === 0) return result;
    const rows = await db
      .select({
        userId: groupMembersTable.user_id,
        groupUuid: groupsTable.uuid,
        name: groupsTable.name,
        role: groupsTable.role,
        systemKey: groupsTable.system_key,
        source: groupMembersTable.source,
      })
      .from(groupMembersTable)
      .innerJoin(
        groupsTable,
        eq(groupsTable.uuid, groupMembersTable.group_uuid),
      )
      .where(inArray(groupMembersTable.user_id, userIds))
      .orderBy(asc(sql`lower(${groupsTable.name})`));

    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push({
        groupUuid: row.groupUuid,
        name: row.name,
        role: row.role,
        systemKey: asSystemKey(row.systemKey),
        source: row.source,
      });
      result.set(row.userId, list);
    }
    return result;
  }

  /** User ids that are effective administrators and not disabled. */
  async findActiveAdminIds(): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT u.id FROM ${usersTable} u
      WHERE u.disabled = false AND (
        u.role = 'admin' OR EXISTS (
          SELECT 1 FROM ${groupMembersTable} gm
          JOIN ${groupsTable} g ON g.uuid = gm.group_uuid
          WHERE gm.user_id = u.id AND g.role = 'admin'
        )
      )
    `);
    return rows.rows.map((row) => row.id);
  }
}

export const groupsRepository = new GroupsRepository();
