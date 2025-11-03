import {
  DatabaseTool,
  ToolCreateInput,
  ToolUpsertInput,
} from "@repo/zod-types";
import { eq, sql } from "drizzle-orm";

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
    return await db
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

  async updateAccessType(
    uuid: string,
    accessType: "read" | "write",
  ): Promise<DatabaseTool | undefined> {
    const [updatedTool] = await db
      .update(toolsTable)
      .set({
        access_type: accessType,
        updated_at: new Date(),
      })
      .where(eq(toolsTable.uuid, uuid))
      .returning();

    return updatedTool;
  }

  async updateAnnotations(
    uuid: string,
    annotations: {
      title?: string;
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    },
  ): Promise<DatabaseTool | undefined> {
    const [updatedTool] = await db
      .update(toolsTable)
      .set({
        annotations,
        updated_at: new Date(),
      })
      .where(eq(toolsTable.uuid, uuid))
      .returning();

    return updatedTool;
  }
}

export const toolsRepository = new ToolsRepository();
