import {
  DatabaseTool,
  ToolCreateInput,
  ToolUpsertInput,
} from "@repo/zod-types";
import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "../index";
import { toolsTable } from "../schema";

export class ToolsRepository {
  async findByMcpServerUuid(mcpServerUuid: string): Promise<DatabaseTool[]> {
    return await db
      .select()
      .from(toolsTable)
      .where(eq(toolsTable.mcp_server_uuid, mcpServerUuid))
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
   * @returns Object with upserted and deleted tools
   */
  async syncTools(input: ToolUpsertInput): Promise<{
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

    return { upserted, deleted };
  }
}

export const toolsRepository = new ToolsRepository();
