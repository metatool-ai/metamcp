import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { db } from "../index.js";
import { dockerSessionsTable } from "../schema.js";

export interface DockerSession {
  uuid: string;
  mcp_server_uuid: string;
  container_id: string;
  container_name: string;
  port: number;
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
  async findAvailablePort(
    basePort: number = 18000,
    maxPorts: number = 1000,
  ): Promise<number> {
    const usedPorts = await db
      .select({ port: dockerSessionsTable.port })
      .from(dockerSessionsTable)
      .where(eq(dockerSessionsTable.status, "running"));

    const usedPortSet = new Set(usedPorts.map((p) => p.port));

    for (let port = basePort; port < basePort + maxPorts; port++) {
      if (!usedPortSet.has(port)) {
        return port;
      }
    }

    throw new Error("No available ports for Docker containers");
  }

  async isPortAvailable(port: number): Promise<boolean> {
    const existingSession = await db
      .select()
      .from(dockerSessionsTable)
      .where(eq(dockerSessionsTable.port, port))
      .limit(1);

    return existingSession.length === 0;
  }

  async reservePort(port: number, mcp_server_uuid: string): Promise<boolean> {
    try {
      const result = await db.transaction(async (tx) => {
        // Check if port is already in use by any session (not just running ones)
        const existingSession = await tx
          .select()
          .from(dockerSessionsTable)
          .where(eq(dockerSessionsTable.port, port))
          .limit(1);

        if (existingSession.length > 0) {
          return false;
        }

        // Try to insert with a unique temporary container ID to avoid conflicts
        const tempContainerId = `temp-${Date.now()}-${Math.random()}`;
        const tempContainerName = `temp-${Date.now()}-${Math.random()}`;

        await tx.insert(dockerSessionsTable).values({
          mcp_server_uuid,
          container_id: tempContainerId,
          container_name: tempContainerName,
          port,
          url: `http://localhost:${port}/sse`,
          status: "running",
        });

        return true;
      });

      return result;
    } catch (error) {
      console.error("Error reserving port:", error);
      return false;
    }
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

  async releasePort(mcp_server_uuid: string): Promise<void> {
    await db
      .delete(dockerSessionsTable)
      .where(eq(dockerSessionsTable.mcp_server_uuid, mcp_server_uuid));
  }

  async createSession(params: {
    mcp_server_uuid: string;
    container_id: string;
    container_name: string;
    port: number;
    url: string;
  }): Promise<DockerSession> {
    const [session] = await db
      .insert(dockerSessionsTable)
      .values({
        ...params,
        status: "running",
        started_at: new Date(),
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
        ...(status === "running" ? { started_at: new Date() } : {}),
        ...(status === "stopped" ? { stopped_at: new Date() } : {}),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async getAllSessions(): Promise<DockerSession[]> {
    return await db.select().from(dockerSessionsTable);
  }

  async incrementRetryCount(uuid: string, errorMessage?: string): Promise<DockerSession | null> {
    const [session] = await db
      .update(dockerSessionsTable)
      .set({
        retry_count: sql`${dockerSessionsTable.retry_count} + 1`,
        last_retry_at: new Date(),
        updated_at: new Date(),
        ...(errorMessage && { error_message: errorMessage }),
      })
      .where(eq(dockerSessionsTable.uuid, uuid))
      .returning();

    return session || null;
  }

  async markAsError(uuid: string, errorMessage: string): Promise<DockerSession | null> {
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
        last_retry_at: null,
        error_message: null,
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
          sql`${dockerSessionsTable.retry_count} > 0`
        )
      );
  }
}

export const dockerSessionsRepo = new DockerSessionsRepository();
