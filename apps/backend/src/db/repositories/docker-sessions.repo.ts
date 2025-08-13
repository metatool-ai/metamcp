import {
  DockerSession,
  DockerSessionStatus,
  DockerSessionStatusEnum,
} from "@repo/zod-types";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { db } from "../index.js";
import { dockerSessionsTable, mcpServersTable } from "../schema.js";

export interface DockerSessionWithServerName extends DockerSession {
  serverName: string;
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
        status: DockerSessionStatusEnum.Enum.RUNNING,
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
        status: DockerSessionStatusEnum.Enum.STOPPED,
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
      .where(
        eq(dockerSessionsTable.status, DockerSessionStatusEnum.Enum.RUNNING),
      );
  }

  async updateSessionStatus(
    uuid: string,
    status: DockerSessionStatus,
  ): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        status,
        updated_at: new Date(),
        ...(status === DockerSessionStatusEnum.Enum.RUNNING && {
          started_at: new Date(),
        }),
        ...(status === DockerSessionStatusEnum.Enum.STOPPED && {
          stopped_at: new Date(),
        }),
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
        status: DockerSessionStatusEnum.Enum.ERROR,
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
          eq(dockerSessionsTable.status, DockerSessionStatusEnum.Enum.RUNNING),
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
        status: DockerSessionStatusEnum.Enum.RUNNING,
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
          eq(dockerSessionsTable.status, DockerSessionStatusEnum.Enum.RUNNING),
          sql`${dockerSessionsTable.container_id} LIKE 'temp-%'`,
        ),
      );

    return result.rowCount || 0;
  }

  async getRunningSessionsWithServerNames(): Promise<
    DockerSessionWithServerName[]
  > {
    return await db
      .select({
        uuid: dockerSessionsTable.uuid,
        mcp_server_uuid: dockerSessionsTable.mcp_server_uuid,
        container_id: dockerSessionsTable.container_id,
        container_name: dockerSessionsTable.container_name,
        url: dockerSessionsTable.url,
        status: dockerSessionsTable.status,
        created_at: dockerSessionsTable.created_at,
        updated_at: dockerSessionsTable.updated_at,
        started_at: dockerSessionsTable.started_at,
        stopped_at: dockerSessionsTable.stopped_at,
        error_message: dockerSessionsTable.error_message,
        retry_count: dockerSessionsTable.retry_count,
        last_retry_at: dockerSessionsTable.last_retry_at,
        max_retries: dockerSessionsTable.max_retries,
        serverName: mcpServersTable.name,
      })
      .from(dockerSessionsTable)
      .innerJoin(
        mcpServersTable,
        eq(dockerSessionsTable.mcp_server_uuid, mcpServersTable.uuid),
      )
      .where(
        eq(dockerSessionsTable.status, DockerSessionStatusEnum.Enum.RUNNING),
      );
  }
}

export const dockerSessionsRepo = new DockerSessionsRepository();
