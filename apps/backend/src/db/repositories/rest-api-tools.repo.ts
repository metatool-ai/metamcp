import { eq, sql } from "drizzle-orm";
import { db } from "../index";
import { restApiToolsTable } from "../schema";

export interface RestApiToolCreateInput {
  name: string;
  display_name?: string;
  description?: string;
  url: string;
  integration_type?: string;
  request_type: string;
  input_schema: {
    type: "object";
    properties?: Record<string, any>;
    required?: string[];
  };
  headers?: Record<string, string>;
  auth_type?: string;
  auth_value?: string;
  server_id: string;
  user_id: string;
  enabled?: boolean;
}

export interface RestApiTool {
  uuid: string;
  name: string;
  display_name: string | null;
  description: string | null;
  url: string;
  integration_type: string;
  request_type: string;
  input_schema: {
    type: "object";
    properties?: Record<string, any>;
    required?: string[];
  };
  headers: Record<string, string>;
  auth_type: string;
  auth_value: string | null;
  server_id: string;
  user_id: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export class RestApiToolsRepository {
  async findByServerId(serverId: string): Promise<RestApiTool[]> {
    return await db
      .select()
      .from(restApiToolsTable)
      .where(eq(restApiToolsTable.server_id, serverId))
      .orderBy(restApiToolsTable.name);
  }

  async create(input: RestApiToolCreateInput): Promise<RestApiTool> {
    const [createdTool] = await db
      .insert(restApiToolsTable)
      .values({
        name: input.name,
        display_name: input.display_name || null,
        description: input.description || null,
        url: input.url,
        integration_type: input.integration_type || "REST",
        request_type: input.request_type,
        input_schema: input.input_schema,
        headers: input.headers || {},
        auth_type: input.auth_type || "none",
        auth_value: input.auth_value || null,
        server_id: input.server_id,
        user_id: input.user_id,
        enabled: input.enabled !== false,
      })
      .returning();

    return createdTool;
  }

  async findByUuid(uuid: string): Promise<RestApiTool | undefined> {
    const [tool] = await db
      .select()
      .from(restApiToolsTable)
      .where(eq(restApiToolsTable.uuid, uuid))
      .limit(1);

    return tool;
  }

  async update(uuid: string, updates: Partial<RestApiToolCreateInput>): Promise<RestApiTool | undefined> {
    const [updatedTool] = await db
      .update(restApiToolsTable)
      .set({
        ...updates,
        updated_at: new Date(),
      })
      .where(eq(restApiToolsTable.uuid, uuid))
      .returning();

    return updatedTool;
  }

  async deleteByUuid(uuid: string): Promise<RestApiTool | undefined> {
    const [deletedTool] = await db
      .delete(restApiToolsTable)
      .where(eq(restApiToolsTable.uuid, uuid))
      .returning();

    return deletedTool;
  }

  async deleteByServerId(serverId: string): Promise<number> {
    const result = await db
      .delete(restApiToolsTable)
      .where(eq(restApiToolsTable.server_id, serverId));

    return result.rowCount || 0;
  }
}

export const restApiToolsRepository = new RestApiToolsRepository();
