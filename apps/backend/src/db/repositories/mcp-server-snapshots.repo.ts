import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "../index";
import { mcpServerSnapshotsTable } from "../schema";

export type McpServerSnapshotRow = typeof mcpServerSnapshotsTable.$inferSelect;
export type McpServerSnapshotInsert = Omit<
  typeof mcpServerSnapshotsTable.$inferInsert,
  "listed_at"
>;

export class McpServerSnapshotsRepository {
  /** Snapshots of these servers listed at `listedSince` or later. */
  async findListedSince(
    serverUuids: string[],
    listedSince: Date,
  ): Promise<McpServerSnapshotRow[]> {
    if (serverUuids.length === 0) {
      return [];
    }
    return db
      .select()
      .from(mcpServerSnapshotsTable)
      .where(
        and(
          inArray(mcpServerSnapshotsTable.mcp_server_uuid, serverUuids),
          gte(mcpServerSnapshotsTable.listed_at, listedSince),
        ),
      );
  }

  async findByServerUuid(
    serverUuid: string,
  ): Promise<McpServerSnapshotRow | undefined> {
    const [row] = await db
      .select()
      .from(mcpServerSnapshotsTable)
      .where(eq(mcpServerSnapshotsTable.mcp_server_uuid, serverUuid));
    return row;
  }

  async upsert(snapshot: McpServerSnapshotInsert): Promise<void> {
    const listedAt = new Date();
    await db
      .insert(mcpServerSnapshotsTable)
      .values({ ...snapshot, listed_at: listedAt })
      .onConflictDoUpdate({
        target: mcpServerSnapshotsTable.mcp_server_uuid,
        set: {
          server_info: snapshot.server_info,
          capabilities: snapshot.capabilities,
          tools: snapshot.tools,
          listed_at: listedAt,
        },
      });
  }

  async deleteByServerUuid(serverUuid: string): Promise<void> {
    await db
      .delete(mcpServerSnapshotsTable)
      .where(eq(mcpServerSnapshotsTable.mcp_server_uuid, serverUuid));
  }
}

export const mcpServerSnapshotsRepository = new McpServerSnapshotsRepository();
