/**
 * MCP server snapshots against a real, migrated Postgres database.
 * Run with: INTEGRATION_DATABASE_URL=... pnpm --filter backend test:integration
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)(
  "MCP server snapshots (integration)",
  async () => {
    const { db, pool } = await import("../index");
    const schema = await import("../schema");
    const { mcpServerSnapshotsRepository } =
      await import("./mcp-server-snapshots.repo");
    const { secretsService } =
      await import("../../lib/secrets/secrets.service");

    let seq = 0;

    async function createServer() {
      const [server] = await db
        .insert(schema.mcpServersTable)
        .values({
          name: `snapshot${++seq}${Date.now()}`,
          type: "STDIO",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
        })
        .returning();
      if (!server) throw new Error("server not created");
      return server;
    }

    const tool = {
      name: "read_graph",
      description: "Read the graph",
      inputSchema: { type: "object" as const },
      annotations: { readOnlyHint: true },
      outputSchema: { type: "object" as const, properties: {} },
    };

    beforeAll(async () => {
      await secretsService.initialize();
    });

    afterAll(async () => {
      await pool.end();
    });

    it("keeps the latest snapshot of a server, with its full tool definitions", async () => {
      const server = await createServer();
      const before = new Date(Date.now() - 1000);

      await mcpServerSnapshotsRepository.upsert({
        mcp_server_uuid: server.uuid,
        server_info: { name: "memory", version: "1.0.0" },
        capabilities: { tools: {} },
        tools: [{ ...tool, name: "old" }],
      });
      await mcpServerSnapshotsRepository.upsert({
        mcp_server_uuid: server.uuid,
        server_info: { name: "memory", version: "1.1.0" },
        capabilities: { tools: {}, prompts: {} },
        tools: [tool],
      });

      const [row] = await mcpServerSnapshotsRepository.findListedSince(
        [server.uuid],
        before,
      );
      expect(row).toMatchObject({
        server_info: { version: "1.1.0" },
        capabilities: { tools: {}, prompts: {} },
        tools: [tool],
      });
    });

    it("returns only the snapshots listed since the given time", async () => {
      const fresh = await createServer();
      const stale = await createServer();
      for (const server of [fresh, stale]) {
        await mcpServerSnapshotsRepository.upsert({
          mcp_server_uuid: server.uuid,
          server_info: null,
          capabilities: { tools: {} },
          tools: [tool],
        });
      }
      await db
        .update(schema.mcpServerSnapshotsTable)
        .set({ listed_at: new Date(Date.now() - 48 * 60 * 60 * 1000) })
        .where(eq(schema.mcpServerSnapshotsTable.mcp_server_uuid, stale.uuid));

      const rows = await mcpServerSnapshotsRepository.findListedSince(
        [fresh.uuid, stale.uuid],
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

      expect(rows.map((row) => row.mcp_server_uuid)).toEqual([fresh.uuid]);
      expect(
        await mcpServerSnapshotsRepository.findListedSince([], new Date(0)),
      ).toEqual([]);
    });

    it("is removed with its server, or on demand", async () => {
      const deleted = await createServer();
      const forgotten = await createServer();
      for (const server of [deleted, forgotten]) {
        await mcpServerSnapshotsRepository.upsert({
          mcp_server_uuid: server.uuid,
          server_info: null,
          capabilities: {},
          tools: [],
        });
      }

      await db
        .delete(schema.mcpServersTable)
        .where(eq(schema.mcpServersTable.uuid, deleted.uuid));
      await mcpServerSnapshotsRepository.deleteByServerUuid(forgotten.uuid);

      expect(
        await mcpServerSnapshotsRepository.findByServerUuid(deleted.uuid),
      ).toBeUndefined();
      expect(
        await mcpServerSnapshotsRepository.findByServerUuid(forgotten.uuid),
      ).toBeUndefined();
    });
  },
);
