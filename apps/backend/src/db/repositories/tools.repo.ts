import {
  DatabaseTool,
  ToolCreateInput,
  ToolUpsertInput,
} from "@repo/zod-types";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "../index";
import {
  namespaceServerMappingsTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../schema";

export class ToolsRepository {
  async findByMcpServerUuid(mcpServerUuid: string): Promise<DatabaseTool[]> {
    return await db
      .select()
      .from(toolsTable)
      .where(eq(toolsTable.mcp_server_uuid, mcpServerUuid))
      .orderBy(toolsTable.name);
  }

  /**
   * Read the fully-scoped, override-aware tool list for a namespace in ONE
   * indexed query — no backend I/O. This is the hot path for serve-from-DB.
   *
   * Returns tools joined through namespace_tool_mappings (scoped to the
   * namespace, ACTIVE status, with override fields applied), restricted to
   * servers currently ACTIVE in the namespace.
   */
  async readToolsForNamespace(
    namespaceUuid: string,
  ): Promise<Array<DatabaseTool & { namespace_status?: string }>> {
    // Subquery: the ACTIVE servers for this namespace (from the namespace→server
    // mappings), so we never surface tools from servers that were removed.
    const activeServerUuids = db
      .select({ uuid: namespaceServerMappingsTable.mcp_server_uuid })
      .from(namespaceServerMappingsTable)
      .where(
        and(
          eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceServerMappingsTable.status, "ACTIVE"),
        ),
      );

    return await db
      .select({
        uuid: toolsTable.uuid,
        name: toolsTable.name,
        description: toolsTable.description,
        toolSchema: toolsTable.toolSchema,
        created_at: toolsTable.created_at,
        updated_at: toolsTable.updated_at,
        mcp_server_uuid: toolsTable.mcp_server_uuid,
        namespace_status: namespaceToolMappingsTable.status,
      })
      .from(toolsTable)
      .innerJoin(
        namespaceToolMappingsTable,
        eq(namespaceToolMappingsTable.tool_uuid, toolsTable.uuid),
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(namespaceToolMappingsTable.status, "ACTIVE"),
          inArray(toolsTable.mcp_server_uuid, activeServerUuids),
        ),
      )
      .orderBy(toolsTable.name);
  }

  async create(input: ToolCreateInput): Promise<DatabaseTool> {
    const [createdTool] = await db.insert(toolsTable).values(input).returning();

    return createdTool;
  }

  async bulkUpsert(input: ToolUpsertInput): Promise<DatabaseTool[]> {
    if (!input.tools || input.tools.length === 0) {
      return [];
    }

    // Format tools for database insertion
    const toolsToInsert = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description || "",
      toolSchema: {
        type: "object" as const,
        ...tool.inputSchema,
      },
      mcp_server_uuid: input.mcpServerUuid,
    }));

    // Batch insert all tools with upsert
    const result = await db
      .insert(toolsTable)
      .values(toolsToInsert)
      .onConflictDoUpdate({
        target: [toolsTable.mcp_server_uuid, toolsTable.name],
        set: {
          description: sql`excluded.description`,
          toolSchema: sql`excluded.tool_schema`,
          updated_at: new Date(),
        },
      })
      .returning();

    return result;
  }

  async findByUuid(uuid: string): Promise<DatabaseTool | undefined> {
    const [tool] = await db
      .select()
      .from(toolsTable)
      .where(eq(toolsTable.uuid, uuid))
      .limit(1);

    return tool;
  }

  async deleteByUuid(uuid: string): Promise<DatabaseTool | undefined> {
    const [deletedTool] = await db
      .delete(toolsTable)
      .where(eq(toolsTable.uuid, uuid))
      .returning();

    return deletedTool;
  }

  /**
   * Delete tools that are no longer present in the current tool list
   * @param mcpServerUuid - UUID of the MCP server
   * @param currentToolNames - Array of tool names that currently exist in the MCP server
   * @returns Array of deleted tools
   */
  async deleteObsoleteTools(
    mcpServerUuid: string,
    currentToolNames: string[],
  ): Promise<DatabaseTool[]> {
    if (currentToolNames.length === 0) {
      // If no tools are provided, delete all tools for this server
      return await db
        .delete(toolsTable)
        .where(eq(toolsTable.mcp_server_uuid, mcpServerUuid))
        .returning();
    }

    // Delete tools that are in DB but not in current tool list
    return await db
      .delete(toolsTable)
      .where(
        and(
          eq(toolsTable.mcp_server_uuid, mcpServerUuid),
          notInArray(toolsTable.name, currentToolNames),
        ),
      )
      .returning();
  }

  /**
   * Sync tools for a server: upsert current tools and delete obsolete ones
   * @param input - Tool upsert input containing tools and server UUID
   * @param namespaceUuid - optional namespace to (re)write namespace_tool_mappings
   *   for. The background tools-sync loop passes this so the DB fast path's
   *   readToolsForNamespace (which INNER JOINs namespace_tool_mappings) actually
   *   finds the synced tools — without it, a freshly-synced server serves an
   *   EMPTY tool list on the DB path. The admin TRPC refresh passes none (it
   *   writes mappings via the namespace layer).
   * @returns Object with upserted and deleted tools
   */
  async syncTools(
    input: ToolUpsertInput,
    namespaceUuid?: string,
  ): Promise<{
    upserted: DatabaseTool[];
    deleted: DatabaseTool[];
  }> {
    const currentToolNames = input.tools.map((tool) => tool.name);

    // First, delete obsolete tools
    const deleted = await this.deleteObsoleteTools(
      input.mcpServerUuid,
      currentToolNames,
    );

    // Then, upsert current tools
    let upserted: DatabaseTool[] = [];
    if (input.tools.length > 0) {
      upserted = await this.bulkUpsert(input);
    }

    // CRITICAL: ensure namespace_tool_mappings exist for the synced tools so the
    // DB fast path (readToolsForNamespace INNER JOIN) serves them. The background
    // sync loop writes tools but historically never wrote mappings — the hot path
    // then returned EMPTY for every freshly-synced namespace (silent 0-tools).
    //
    // Operator intent must be preserved: a tool the operator disabled (mapping
    // status INACTIVE) must STAY disabled across every background sync pass.
    //   - On INSERT: default status ACTIVE (new tool — no operator intent yet).
    //   - On conflict: DO NOT set status. `onConflictDoUpdate` requires a
    //     non-empty `set`, so self-assign `status = namespace_tool_mappings.status`
    //     — a no-op that leaves the stored value (ACTIVE or INACTIVE) untouched.
    if (namespaceUuid && upserted.length > 0) {
      await db
        .insert(namespaceToolMappingsTable)
        .values(
          upserted.map((tool) => ({
            namespace_uuid: namespaceUuid,
            tool_uuid: tool.uuid,
            mcp_server_uuid: tool.mcp_server_uuid,
            status: "ACTIVE" as const,
          })),
        )
        .onConflictDoUpdate({
          target: [
            namespaceToolMappingsTable.namespace_uuid,
            namespaceToolMappingsTable.tool_uuid,
          ],
          set: {
            status: sql`${namespaceToolMappingsTable.status}`,
          },
        });
    }

    return { upserted, deleted };
  }
}

export const toolsRepository = new ToolsRepository();
