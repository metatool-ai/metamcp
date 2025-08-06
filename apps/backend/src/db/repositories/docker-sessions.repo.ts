import { and, eq } from "drizzle-orm";

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

  async reservePort(port: number, mcp_server_uuid: string): Promise<boolean> {
    try {
      const result = await db.transaction(async (tx) => {
        const existingSession = await tx
          .select()
          .from(dockerSessionsTable)
          .where(
            and(
              eq(dockerSessionsTable.port, port),
              eq(dockerSessionsTable.status, "running"),
            ),
          )
          .limit(1);

        if (existingSession.length > 0) {
          return false;
        }

        await tx.insert(dockerSessionsTable).values({
          mcp_server_uuid,
          container_id: `temp-${Date.now()}-${Math.random()}`,
          container_name: `temp-${Date.now()}-${Math.random()}`,
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
}

export const dockerSessionsRepo = new DockerSessionsRepository();
