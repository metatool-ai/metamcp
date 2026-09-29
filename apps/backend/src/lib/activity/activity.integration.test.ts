/**
 * Activity log against a real, migrated Postgres database.
 * Run with: INTEGRATION_DATABASE_URL=... pnpm --filter backend test:integration
 */
import type { AccessPrincipal, Role } from "@repo/zod-types";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../metamcp/mcp-server-pool", () => ({
  mcpServerPool: {
    ensureIdleSessionForNewServer: vi.fn(async () => undefined),
    invalidateIdleSession: vi.fn(async () => undefined),
    cleanupIdleSession: vi.fn(async () => undefined),
  },
}));
vi.mock("../metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {
    ensureIdleServerForNewNamespace: vi.fn(async () => undefined),
    invalidateIdleServer: vi.fn(async () => undefined),
    invalidateIdleServers: vi.fn(async () => undefined),
    invalidateOpenApiSessions: vi.fn(async () => undefined),
    cleanupIdleServer: vi.fn(async () => undefined),
  },
}));

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("activity log (integration)", async () => {
  const { db, pool } = await import("../../db/index");
  const schema = await import("../../db/schema");
  const { accessService } = await import("../access/access.service");
  const { groupsRepository } =
    await import("../../db/repositories/groups.repo");
  const { activityLogsRepository } =
    await import("../../db/repositories/activity-logs.repo");
  const { activityLog } = await import("./activity-log.service");
  const { adminImplementations } = await import("../../trpc/admin.impl");
  const { sharesImplementations } = await import("../../trpc/shares.impl");
  const { mcpServersImplementations } =
    await import("../../trpc/mcp-servers.impl");
  const { secretsService } = await import("../secrets/secrets.service");

  let seq = 0;

  async function createUser(role: Role) {
    const id = `activity-user-${++seq}-${Date.now()}`;
    await db.insert(schema.usersTable).values({
      id,
      name: `User ${seq}`,
      email: `${id}@example.com`,
      emailVerified: true,
      role,
    });
    return id;
  }

  async function principal(userId: string): Promise<AccessPrincipal> {
    accessService.invalidateUser(userId);
    const resolved = await accessService.getPrincipal(userId);
    if (!resolved) throw new Error(`no principal for ${userId}`);
    return resolved;
  }

  async function entries(action?: string) {
    const { entries: rows } = await activityLog.list({
      offset: 0,
      limit: 200,
      ...(action ? { search: action } : {}),
    });
    return action ? rows.filter((row) => row.action === action) : rows;
  }

  beforeAll(async () => {
    await secretsService.initialize();
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE activity_logs, resource_shares, group_members,
        namespace_server_mappings, namespaces, mcp_servers, sessions,
        accounts, users, config
      RESTART IDENTITY CASCADE
    `);
    await db.execute(sql`DELETE FROM groups WHERE system_key IS NULL`);
    await groupsRepository.ensureSystemGroups();
    accessService.invalidateAll();
  });

  afterAll(async () => {
    secretsService.stop();
    await pool.end();
  });

  it("records who changed a role, from what to what", async () => {
    const admin = await createUser("admin");
    const target = await createUser("viewer");
    const result = await adminImplementations.users.update(
      { id: target, baseRole: "editor" },
      await principal(admin),
    );
    expect(result.success).toBe(true);

    const [entry] = await entries("user.updated");
    expect(entry.actorId).toBe(admin);
    expect(entry.actorEmail).toBe(`${admin}@example.com`);
    expect(entry.category).toBe("users");
    expect(entry.targetLabel).toBe(`${target}@example.com`);
    expect(entry.details).toEqual({
      changes: { baseRole: { from: "viewer", to: "editor" } },
    });
  });

  it("records shares granted and revoked", async () => {
    const owner = await createUser("editor");
    const reader = await createUser("viewer");
    const created = await mcpServersImplementations.create(
      {
        name: "shared-server",
        type: "STREAMABLE_HTTP",
        url: "https://mcp.example.com/mcp",
        command: "",
        args: [],
        env: {},
      },
      await principal(owner),
    );
    const serverUuid = created.success ? (created.data?.uuid ?? "") : "";
    await sharesImplementations.upsert(
      {
        resourceType: "mcp_server",
        resourceUuid: serverUuid,
        subjectType: "user",
        subjectId: reader,
        level: "use",
      },
      await principal(owner),
    );
    const [share] = await db.select().from(schema.resourceSharesTable);
    await sharesImplementations.remove(
      { shareUuid: share.uuid },
      await principal(owner),
    );

    const [granted] = await entries("share.granted");
    expect(granted.targetLabel).toBe("shared-server");
    expect(granted.details).toMatchObject({
      subject: `${reader}@example.com`,
      level: "use",
    });
    const [revoked] = await entries("share.revoked");
    expect(revoked.details).toMatchObject({ level: "use" });
    expect(await entries("mcp_server.created")).toHaveLength(1);
  });

  it("names changed secrets without recording their values", async () => {
    const owner = await createUser("admin");
    const created = await mcpServersImplementations.create(
      {
        name: "secret-server",
        type: "STREAMABLE_HTTP",
        url: "https://mcp.example.com/mcp",
        bearerToken: "old-bearer-value",
        command: "",
        args: [],
        env: {},
      },
      await principal(owner),
    );
    const uuid = created.success ? (created.data?.uuid ?? "") : "";
    await mcpServersImplementations.update(
      {
        uuid,
        name: "secret-server",
        type: "STREAMABLE_HTTP",
        url: "https://mcp.example.com/mcp?key=new-url-secret",
        bearerToken: "new-bearer-value",
        headers: { "X-Api-Key": "new-header-secret" },
        command: "",
        args: [],
        env: {},
      },
      await principal(owner),
    );

    const [updated] = await entries("mcp_server.updated");
    expect(updated.details.changedFields).toEqual(
      expect.arrayContaining(["url", "bearerToken", "headers.X-Api-Key"]),
    );
    const dump = JSON.stringify(
      await db.execute(sql`select * from activity_logs`),
    );
    for (const secret of [
      "old-bearer-value",
      "new-bearer-value",
      "new-url-secret",
      "new-header-secret",
    ]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("filters, exports CSV safely and never updates entries", async () => {
    await activityLog.record({
      actor: { kind: "system", label: "Test" },
      action: "settings.updated",
      target: { type: "setting", id: "X", label: "=cmd|' /C calc'!A0" },
    });
    await activityLog.record({
      actor: { kind: "system", label: "Test" },
      action: "auth.sign_in_denied",
      outcome: "denied",
      target: { type: "user", id: null, label: "someone@example.com" },
      details: { reason: "sso_no_matching_group" },
    });

    const denied = await activityLog.list({
      offset: 0,
      limit: 10,
      outcome: "denied",
    });
    expect(denied.total).toBe(1);
    expect(denied.entries[0].category).toBe("auth");
    const settings = await activityLog.list({
      offset: 0,
      limit: 10,
      category: "settings",
    });
    expect(settings.total).toBe(1);

    const { csv, truncated } = await activityLog.exportCsv({});
    expect(truncated).toBe(false);
    expect(csv.split("\r\n")[0]).toContain('"time","actor_type"');
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`);

    // Drizzle wraps the Postgres error raised by the trigger.
    const failure = await db
      .execute(sql`update activity_logs set action = 'tampered'`)
      .then(() => null)
      .catch((error: Error & { cause?: Error }) => error);
    expect(String(failure?.cause?.message ?? failure)).toMatch(/append-only/);

    const removed = await activityLogsRepository.deleteOlderThan(
      new Date(Date.now() + 60_000),
    );
    expect(removed).toBe(2);
  });
});
