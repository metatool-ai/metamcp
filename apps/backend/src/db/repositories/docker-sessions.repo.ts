import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { db } from "../index.js";
import { dockerSessionsTable } from "../schema.js";

export interface DockerSession {
  uuid: string;
  mcp_server_uuid: string;
  container_id: string;
  container_name: string;
  url: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  started_at?: Date | null;
  stopped_at?: Date | null;
  error_message?: string | null;
  retry_count: number;
  last_retry_at?: Date | null;
  max_retries: number;
}

export class DockerSessionsRepository {
  async createSession(params: {
    mcp_server_uuid: string;
    container_id: string;
    container_name: string;
    url: string;
  }): Promise<DockerSession> {
    const [session] = await db
      .insert(dockerSessionsTable)
      .values({
        mcp_server_uuid: params.mcp_server_uuid,
        container_id: params.container_id,
        container_name: params.container_name,
        url: params.url,
        status: "running",
      })
      .returning();

    return session;
  }

  async getSessionByMcpServer(
    mcp_server_uuid: string,
  ): Promise<DockerSession | null> {
    const [session] = await db
      .select()
      .from(dockerSessionsTable)
      .where(eq(dockerSessionsTable.mcp_server_uuid, mcp_server_uuid))
      .limit(1);

    return session || null;
  }

  async stopSession(uuid: string): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        status: "stopped",
        stopped_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async deleteSession(uuid: string): Promise<void> {
    await db
      .delete(dockerSessionsTable)
      .where(eq(dockerSessionsTable.uuid, uuid));
  }

  async getRunningSessions(): Promise<DockerSession[]> {
    return await db
      .select()
      .from(dockerSessionsTable)
      .where(eq(dockerSessionsTable.status, "running"));
  }

  async updateSessionStatus(
    uuid: string,
    status: string,
  ): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        status,
        updated_at: new Date(),
        ...(status === "running" && { started_at: new Date() }),
        ...(status === "stopped" && { stopped_at: new Date() }),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async getAllSessions(): Promise<DockerSession[]> {
    return await db.select().from(dockerSessionsTable);
  }

  async incrementRetryCount(
    uuid: string,
    errorMessage?: string,
  ): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        retry_count: sql`${dockerSessionsTable.retry_count} + 1`,
        last_retry_at: new Date(),
        error_message: errorMessage || null,
        updated_at: new Date(),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async markAsError(
    uuid: string,
    errorMessage: string,
  ): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        status: "error",
        error_message: errorMessage,
        stopped_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async resetRetryCount(uuid: string): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        retry_count: 0,
        error_message: null,
        last_retry_at: null,
        updated_at: new Date(),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async getSessionsWithRetryInfo(): Promise<DockerSession[]> {
    return await db
      .select()
      .from(dockerSessionsTable)
      .where(
        and(
          eq(dockerSessionsTable.status, "running"),
          sql`${dockerSessionsTable.retry_count} > 0`,
        ),
      );
  }

  async updateSessionWithContainerDetails(
    mcp_server_uuid: string,
    container_id: string,
    container_name: string,
    url: string,
  ): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        container_id,
        container_name,
        url,
        status: "running",
        started_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(dockerSessionsTable.mcp_server_uuid, mcp_server_uuid))
      .returning();

    return session || null;
  }

  async cleanupTemporarySessions(): Promise<number> {
    const result = await db
      .delete(dockerSessionsTable)
      .where(
        and(
          eq(dockerSessionsTable.status, "running"),
          sql`${dockerSessionsTable.container_id} LIKE 'temp-%'`,
        ),
      );

    return result.rowCount || 0;
  }
}

export const dockerSessionsRepo = new DockerSessionsRepository();
