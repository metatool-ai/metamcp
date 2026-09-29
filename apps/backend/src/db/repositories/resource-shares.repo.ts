import type {
  ShareLevel,
  ShareResourceType,
  SystemGroupKey,
} from "@repo/zod-types";
import { and, asc, count, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db } from "../index";
import {
  groupMembersTable,
  groupsTable,
  mcpServersTable,
  namespacesTable,
  resourceSharesTable,
  usersTable,
} from "../schema";

export type ShareGrantRow = {
  resourceUuid: string;
  userId: string | null;
  groupUuid: string | null;
  level: ShareLevel;
};

export type ShareWithSubjectRow = {
  uuid: string;
  level: ShareLevel;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
  groupUuid: string | null;
  groupName: string | null;
  groupSystemKey: string | null;
};

function resourceColumn(type: ShareResourceType) {
  return type === "mcp_server"
    ? resourceSharesTable.mcp_server_uuid
    : resourceSharesTable.namespace_uuid;
}

function asSystemKey(value: string | null): SystemGroupKey | null {
  return value === "admins" || value === "everyone" ? value : null;
}

export class ResourceSharesRepository {
  /** All grants on the given resources (used to compute per-row access). */
  async findGrantsForResources(
    type: ShareResourceType,
    resourceUuids: string[],
  ): Promise<ShareGrantRow[]> {
    if (resourceUuids.length === 0) return [];
    const column = resourceColumn(type);
    const rows = await db
      .select({
        resourceUuid: column,
        userId: resourceSharesTable.user_id,
        groupUuid: resourceSharesTable.group_uuid,
        level: resourceSharesTable.level,
      })
      .from(resourceSharesTable)
      .where(inArray(column, resourceUuids));
    return rows.filter(
      (row): row is ShareGrantRow => row.resourceUuid !== null,
    );
  }

  /**
   * Resource uuids shared with the user directly or with one of the given
   * groups (callers include the Everyone group uuid).
   */
  async findSharedResourceUuids(
    type: ShareResourceType,
    userId: string,
    groupUuids: string[],
  ): Promise<string[]> {
    const column = resourceColumn(type);
    const subjectFilter =
      groupUuids.length > 0
        ? or(
            eq(resourceSharesTable.user_id, userId),
            inArray(resourceSharesTable.group_uuid, groupUuids),
          )
        : eq(resourceSharesTable.user_id, userId);
    const rows = await db
      .selectDistinct({ uuid: column })
      .from(resourceSharesTable)
      .where(and(isNotNull(column), subjectFilter));
    return rows
      .map((row) => row.uuid)
      .filter((uuid): uuid is string => uuid !== null);
  }

  async listForResource(
    type: ShareResourceType,
    resourceUuid: string,
  ): Promise<ShareWithSubjectRow[]> {
    const column = resourceColumn(type);
    return await db
      .select({
        uuid: resourceSharesTable.uuid,
        level: resourceSharesTable.level,
        createdAt: resourceSharesTable.created_at,
        userId: usersTable.id,
        userName: usersTable.name,
        userEmail: usersTable.email,
        userImage: usersTable.image,
        groupUuid: groupsTable.uuid,
        groupName: groupsTable.name,
        groupSystemKey: groupsTable.system_key,
      })
      .from(resourceSharesTable)
      .leftJoin(usersTable, eq(usersTable.id, resourceSharesTable.user_id))
      .leftJoin(
        groupsTable,
        eq(groupsTable.uuid, resourceSharesTable.group_uuid),
      )
      .where(eq(column, resourceUuid))
      .orderBy(
        // Everyone first, then groups, then users.
        sql`${groupsTable.system_key} IS DISTINCT FROM 'everyone'`,
        sql`${resourceSharesTable.group_uuid} IS NULL`,
        asc(sql`lower(coalesce(${groupsTable.name}, ${usersTable.name}))`),
      );
  }

  async findByUuid(uuid: string) {
    const [share] = await db
      .select()
      .from(resourceSharesTable)
      .where(eq(resourceSharesTable.uuid, uuid))
      .limit(1);
    return share;
  }

  async upsert(input: {
    type: ShareResourceType;
    resourceUuid: string;
    subject: { userId: string } | { groupUuid: string };
    level: ShareLevel;
    createdBy: string | null;
  }): Promise<void> {
    const column = resourceColumn(input.type);
    const isUser = "userId" in input.subject;
    const subjectColumn = isUser
      ? resourceSharesTable.user_id
      : resourceSharesTable.group_uuid;

    await db
      .insert(resourceSharesTable)
      .values({
        mcp_server_uuid:
          input.type === "mcp_server" ? input.resourceUuid : null,
        namespace_uuid: input.type === "namespace" ? input.resourceUuid : null,
        user_id: "userId" in input.subject ? input.subject.userId : null,
        group_uuid:
          "groupUuid" in input.subject ? input.subject.groupUuid : null,
        level: input.level,
        created_by: input.createdBy,
      })
      .onConflictDoUpdate({
        target: [column, subjectColumn],
        targetWhere: sql`${column} IS NOT NULL AND ${subjectColumn} IS NOT NULL`,
        set: { level: input.level, updated_at: new Date() },
      });
  }

  async delete(uuid: string): Promise<boolean> {
    const deleted = await db
      .delete(resourceSharesTable)
      .where(eq(resourceSharesTable.uuid, uuid))
      .returning({ uuid: resourceSharesTable.uuid });
    return deleted.length > 0;
  }

  /** Shares received by a group, with resource names (group detail page). */
  async listForGroup(groupUuid: string) {
    const rows = await db
      .select({
        shareUuid: resourceSharesTable.uuid,
        level: resourceSharesTable.level,
        mcpServerUuid: resourceSharesTable.mcp_server_uuid,
        mcpServerName: mcpServersTable.name,
        namespaceUuid: resourceSharesTable.namespace_uuid,
        namespaceName: namespacesTable.name,
      })
      .from(resourceSharesTable)
      .leftJoin(
        mcpServersTable,
        eq(mcpServersTable.uuid, resourceSharesTable.mcp_server_uuid),
      )
      .leftJoin(
        namespacesTable,
        eq(namespacesTable.uuid, resourceSharesTable.namespace_uuid),
      )
      .where(eq(resourceSharesTable.group_uuid, groupUuid));

    return rows.map((row) =>
      row.mcpServerUuid
        ? {
            shareUuid: row.shareUuid,
            resourceType: "mcp_server" as const,
            resourceUuid: row.mcpServerUuid,
            resourceName: row.mcpServerName ?? "",
            level: row.level,
          }
        : {
            shareUuid: row.shareUuid,
            resourceType: "namespace" as const,
            resourceUuid: row.namespaceUuid ?? "",
            resourceName: row.namespaceName ?? "",
            level: row.level,
          },
    );
  }

  /** Number of shares per resource (to show "Shared" badges in lists). */
  async countForResources(
    type: ShareResourceType,
    resourceUuids: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (resourceUuids.length === 0) return result;
    const column = resourceColumn(type);
    const rows = await db
      .select({ uuid: column, value: count() })
      .from(resourceSharesTable)
      .where(inArray(column, resourceUuids))
      .groupBy(column);
    for (const row of rows) {
      if (row.uuid) result.set(row.uuid, row.value);
    }
    return result;
  }

  /** Users who would receive access through a share on a group (for previews). */
  async countGroupMembers(groupUuid: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.group_uuid, groupUuid));
    return row?.value ?? 0;
  }

  static toSubject(row: ShareWithSubjectRow) {
    if (row.groupUuid) {
      return {
        type: "group" as const,
        id: row.groupUuid,
        name: row.groupName ?? "",
        email: null,
        image: null,
        systemKey: asSystemKey(row.groupSystemKey),
      };
    }
    return {
      type: "user" as const,
      id: row.userId ?? "",
      name: row.userName ?? "",
      email: row.userEmail,
      image: row.userImage,
      systemKey: null,
    };
  }
}

export const resourceSharesRepository = new ResourceSharesRepository();
