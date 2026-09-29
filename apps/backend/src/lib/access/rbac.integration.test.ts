/**
 * RBAC integration tests against a real, migrated Postgres database.
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

// Connection pools spawn/connect to MCP servers: irrelevant here.
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

describe.skipIf(!hasDatabase)("RBAC (integration)", async () => {
  const { db, pool } = await import("../../db/index");
  const schema = await import("../../db/schema");
  const { accessService } = await import("./access.service");
  const { clearAccessSettingsCache, accessSettings } =
    await import("./access-settings");
  const { groupsRepository } =
    await import("../../db/repositories/groups.repo");
  const { resourceSharesRepository } =
    await import("../../db/repositories/resource-shares.repo");
  const { ApiKeysRepository } =
    await import("../../db/repositories/api-keys.repo");
  const { mcpServersImplementations } =
    await import("../../trpc/mcp-servers.impl");
  const { namespacesImplementations } =
    await import("../../trpc/namespaces.impl");
  const { endpointsImplementations } =
    await import("../../trpc/endpoints.impl");
  const { sharesImplementations } = await import("../../trpc/shares.impl");
  const { adminImplementations } = await import("../../trpc/admin.impl");
  const { apiKeysImplementations } = await import("../../trpc/api-keys.impl");
  const { mcpRequestAuditLogsImplementations } =
    await import("../../trpc/mcp-request-audit-logs.impl");
  const { oidcSyncService } = await import("./oidc-sync.service");
  const { secretsService } = await import("../secrets/secrets.service");

  let seq = 0;

  async function resetDatabase() {
    await db.execute(sql`
      TRUNCATE TABLE
        mcp_request_audit_logs, resource_shares, group_members,
        namespace_tool_mappings, namespace_server_mappings, tools, endpoints,
        namespaces, oauth_sessions, mcp_servers, api_keys, oauth_access_tokens,
        oauth_authorization_codes, sessions, accounts, users, config
      RESTART IDENTITY CASCADE
    `);
    await db.execute(sql`DELETE FROM groups WHERE system_key IS NULL`);
    await db.execute(
      sql`UPDATE groups SET role = CASE WHEN system_key = 'admins' THEN 'admin'::user_role ELSE NULL END, oidc_groups = '{}'`,
    );
    await groupsRepository.ensureSystemGroups();
    accessService.invalidateAll();
    clearAccessSettingsCache();
  }

  async function createUser(role: Role, name = `user${++seq}`) {
    const id = `${name}-${seq}-${Date.now()}`;
    await db.insert(schema.usersTable).values({
      id,
      name,
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

  async function createServer(
    ownerId: string | null,
    options: {
      type?: "STDIO" | "STREAMABLE_HTTP";
      env?: Record<string, string>;
    } = {},
  ) {
    const type = options.type ?? "STREAMABLE_HTTP";
    const [server] = await db
      .insert(schema.mcpServersTable)
      .values({
        name: `srv${++seq}`,
        type,
        url:
          type === "STDIO"
            ? null
            : `https://mcp${seq}.example.com/mcp?token=secret`,
        command: type === "STDIO" ? "npx" : null,
        args: type === "STDIO" ? ["server", "--token", "secret"] : [],
        env: options.env ?? { API_KEY: "super-secret" },
        bearerToken: "bearer-secret",
        headers: { "X-Api-Key": "header-secret" },
        user_id: ownerId,
      })
      .returning();
    return server;
  }

  async function createNamespace(
    ownerId: string | null,
    serverUuids: string[] = [],
  ) {
    const [namespace] = await db
      .insert(schema.namespacesTable)
      .values({ name: `ns${++seq}`, user_id: ownerId })
      .returning();
    if (serverUuids.length > 0) {
      await db.insert(schema.namespaceServerMappingsTable).values(
        serverUuids.map((uuid) => ({
          namespace_uuid: namespace.uuid,
          mcp_server_uuid: uuid,
        })),
      );
    }
    return namespace;
  }

  async function createGroup(role: Role | null = null) {
    return groupsRepository.create({ name: `group${++seq}`, role });
  }

  async function adminsGroup() {
    const group = await groupsRepository.findBySystemKey("admins");
    if (!group) throw new Error("missing Administrators group");
    return group;
  }

  async function everyone() {
    const group = await groupsRepository.findBySystemKey("everyone");
    if (!group) throw new Error("missing Everyone group");
    return group;
  }

  async function share(
    type: "mcp_server" | "namespace",
    resourceUuid: string,
    subject: { userId: string } | { groupUuid: string },
    level: "use" | "edit" | "manage",
  ) {
    await resourceSharesRepository.upsert({
      type,
      resourceUuid,
      subject,
      level,
      createdBy: null,
    });
    accessService.invalidateAll();
  }

  beforeAll(async () => {
    // MCP server secrets are encrypted at rest: load the data keys first.
    await secretsService.initialize();
    await resetDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    secretsService.stop();
    await pool.end();
  });

  describe("principal resolution", () => {
    it("elevates the base role with group roles and the Everyone role", async () => {
      const viewer = await createUser("viewer");
      expect((await principal(viewer)).role).toBe("viewer");

      const editors = await createGroup("editor");
      await groupsRepository.addMembers(editors.uuid, [viewer], "manual");
      expect((await principal(viewer)).role).toBe("editor");

      const admins = await adminsGroup();
      await groupsRepository.addMembers(admins.uuid, [viewer], "manual");
      const elevated = await principal(viewer);
      expect(elevated.isAdmin).toBe(true);
      expect(elevated.capabilities).toContain("mcp_servers.create_stdio");
    });

    it("treats disabled users as anonymous", async () => {
      const user = await createUser("editor");
      await db
        .update(schema.usersTable)
        .set({ disabled: true })
        .where(sql`id = ${user}`);
      accessService.invalidateUser(user);
      expect(await accessService.getPrincipal(user)).toBeNull();
    });

    it("applies the configured role matrix", async () => {
      await accessSettings.setRolePermissions({
        editor: ["namespaces.create"],
        viewer: [],
      });
      const editor = await createUser("editor");
      expect((await principal(editor)).capabilities).toEqual([
        "namespaces.create",
      ]);
    });
  });

  describe("MCP servers", () => {
    it("lists only owned and shared servers, redacting secrets at use level", async () => {
      const alice = await createUser("editor");
      const bob = await createUser("editor");
      const aliceServer = await createServer(alice);
      const orgServer = await createServer(null);
      await createServer(bob);

      const devs = await createGroup();
      await groupsRepository.addMembers(devs.uuid, [bob], "manual");
      await share(
        "mcp_server",
        orgServer.uuid,
        { groupUuid: devs.uuid },
        "use",
      );

      const aliceList = await mcpServersImplementations.list(
        await principal(alice),
      );
      expect(aliceList.data.map((server) => server.uuid)).toEqual([
        aliceServer.uuid,
      ]);
      expect(aliceList.data[0].secretsRedacted).toBe(false);
      expect(aliceList.data[0].env.API_KEY).toBe("super-secret");

      const bobList = await mcpServersImplementations.list(
        await principal(bob),
      );
      const shared = bobList.data.find(
        (server) => server.uuid === orgServer.uuid,
      );
      expect(shared?.access).toEqual({ level: "use", reason: "share" });
      expect(shared?.secretsRedacted).toBe(true);
      expect(shared?.env).toEqual({ API_KEY: "" });
      expect(shared?.bearerToken).toBeNull();
      expect(shared?.headers).toEqual({ "X-Api-Key": "" });
      expect(shared?.url).not.toContain("secret");
      expect(
        bobList.data.some((server) => server.uuid === aliceServer.uuid),
      ).toBe(false);
    });

    it("lets admins see everything", async () => {
      const admin = await createUser("admin");
      const user = await createUser("editor");
      await createServer(user);
      await createServer(null);
      const list = await mcpServersImplementations.list(await principal(admin));
      expect(list.data).toHaveLength(2);
      expect(
        list.data.every((server) => server.access?.reason === "admin"),
      ).toBe(true);
    });

    it("enforces capabilities and ownership on create", async () => {
      const viewer = await createUser("viewer");
      const editor = await createUser("editor");
      const admin = await createUser("admin");
      const remote = {
        name: "remote-srv",
        type: "STREAMABLE_HTTP" as const,
        url: "https://remote.example.com/mcp",
        forward_headers: {},
      };

      expect(
        (
          await mcpServersImplementations.create(
            remote,
            await principal(viewer),
          )
        ).success,
      ).toBe(false);

      const stdio = await mcpServersImplementations.create(
        {
          name: "stdio-srv",
          type: "STDIO",
          command: "npx",
          forward_headers: {},
        },
        await principal(editor),
      );
      expect(stdio.success).toBe(false);
      expect(stdio.message).toMatch(/STDIO/);

      const org = await mcpServersImplementations.create(
        { ...remote, user_id: null },
        await principal(editor),
      );
      expect(org.success).toBe(false);

      const impersonation = await mcpServersImplementations.create(
        { ...remote, user_id: admin },
        await principal(editor),
      );
      expect(impersonation.success).toBe(false);

      const created = await mcpServersImplementations.create(
        remote,
        await principal(editor),
      );
      expect(created.success).toBe(true);
      expect(created.data?.user_id).toBe(editor);

      const orgByAdmin = await mcpServersImplementations.create(
        { ...remote, name: "org-srv", user_id: null },
        await principal(admin),
      );
      expect(orgByAdmin.success).toBe(true);
      expect(orgByAdmin.data?.user_id).toBeNull();
    });

    it("requires edit to update, manage to delete, and the STDIO permission to change commands", async () => {
      const owner = await createUser("admin");
      const editor = await createUser("editor");
      const server = await createServer(owner, { type: "STDIO" });
      const base = {
        uuid: server.uuid,
        name: server.name,
        type: "STDIO" as const,
        command: "npx",
        args: server.args,
        env: server.env,
        forward_headers: {},
      };

      await share("mcp_server", server.uuid, { userId: editor }, "use");
      const denied = await mcpServersImplementations.update(
        { ...base, description: "x" },
        await principal(editor),
      );
      expect(denied.success).toBe(false);

      await share("mcp_server", server.uuid, { userId: editor }, "edit");
      const described = await mcpServersImplementations.update(
        { ...base, description: "now documented" },
        await principal(editor),
      );
      expect(described.success).toBe(true);

      const rce = await mcpServersImplementations.update(
        { ...base, command: "bash" },
        await principal(editor),
      );
      expect(rce.success).toBe(false);
      expect(rce.message).toMatch(/STDIO/);

      const takeover = await mcpServersImplementations.update(
        { ...base, user_id: editor },
        await principal(editor),
      );
      expect(takeover.success).toBe(false);

      const deleteDenied = await mcpServersImplementations.delete(
        { uuid: server.uuid },
        await principal(editor),
      );
      expect(deleteDenied.success).toBe(false);

      await share("mcp_server", server.uuid, { userId: editor }, "manage");
      const deleted = await mcpServersImplementations.delete(
        { uuid: server.uuid },
        await principal(editor),
      );
      expect(deleted.success).toBe(true);
    });

    it("no longer lets anyone edit formerly public servers", async () => {
      const editor = await createUser("editor");
      const orgServer = await createServer(null);
      await share(
        "mcp_server",
        orgServer.uuid,
        { groupUuid: (await everyone()).uuid },
        "use",
      );
      const result = await mcpServersImplementations.update(
        {
          uuid: orgServer.uuid,
          name: orgServer.name,
          type: "STREAMABLE_HTTP",
          url: "https://evil.example.com/mcp",
          forward_headers: {},
        },
        await principal(editor),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("namespaces", () => {
    it("hides server secrets inside a namespace unless the caller can edit the server", async () => {
      const admin = await createUser("admin");
      const viewer = await createUser("viewer");
      const server = await createServer(admin);
      const namespace = await createNamespace(admin, [server.uuid]);
      await share("namespace", namespace.uuid, { userId: viewer }, "use");

      const result = await namespacesImplementations.get(
        { uuid: namespace.uuid },
        await principal(viewer),
      );
      expect(result.success).toBe(true);
      expect(result.data?.access?.level).toBe("use");
      expect(result.data?.servers[0].env).toEqual({ API_KEY: "" });
      expect(result.data?.servers[0].bearerToken).toBeNull();

      const edit = await namespacesImplementations.update(
        {
          uuid: namespace.uuid,
          name: "renamed",
          mcpServerUuids: [server.uuid],
        },
        await principal(viewer),
      );
      expect(edit.success).toBe(false);
    });

    it("refuses to share a namespace that would redistribute a use-only server", async () => {
      const admin = await createUser("admin");
      const editor = await createUser("editor");
      const adminServer = await createServer(admin);
      await share("mcp_server", adminServer.uuid, { userId: editor }, "use");

      const created = await namespacesImplementations.create(
        { name: "mine", mcpServerUuids: [adminServer.uuid] },
        await principal(editor),
      );
      expect(created.success).toBe(true);
      const namespaceUuid = created.data?.uuid ?? "";
      expect(namespaceUuid).not.toBe("");

      const team = await createGroup();
      const blocked = await sharesImplementations.upsert(
        {
          resourceType: "namespace",
          resourceUuid: namespaceUuid,
          subjectType: "group",
          subjectId: team.uuid,
          level: "use",
        },
        await principal(editor),
      );
      expect(blocked.success).toBe(false);
      expect(blocked.message).toMatch(/for your own use only/);

      // Once the owner makes the server available to everyone, it is fine.
      await share(
        "mcp_server",
        adminServer.uuid,
        { groupUuid: (await everyone()).uuid },
        "use",
      );
      const allowed = await sharesImplementations.upsert(
        {
          resourceType: "namespace",
          resourceUuid: namespaceUuid,
          subjectType: "group",
          subjectId: team.uuid,
          level: "use",
        },
        await principal(editor),
      );
      expect(allowed.success).toBe(true);
    });

    it("refuses to add a use-only server to a namespace that is already shared", async () => {
      const admin = await createUser("admin");
      const editor = await createUser("editor");
      const own = await createServer(editor);
      const adminServer = await createServer(admin);
      await share("mcp_server", adminServer.uuid, { userId: editor }, "use");
      const namespace = await createNamespace(editor, [own.uuid]);
      await share(
        "namespace",
        namespace.uuid,
        { groupUuid: (await createGroup()).uuid },
        "use",
      );

      const result = await namespacesImplementations.update(
        {
          uuid: namespace.uuid,
          name: namespace.name,
          mcpServerUuids: [own.uuid, adminServer.uuid],
        },
        await principal(editor),
      );
      expect(result.success).toBe(false);
    });

    it("rejects servers the caller cannot use", async () => {
      const alice = await createUser("editor");
      const bob = await createUser("editor");
      const bobServer = await createServer(bob);
      const result = await namespacesImplementations.create(
        { name: "steal", mcpServerUuids: [bobServer.uuid] },
        await principal(alice),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("endpoints", () => {
    const endpointInput = (namespaceUuid: string, name: string) => ({
      name,
      namespaceUuid,
      enableApiKeyAuth: true,
      enableClientMaxRate: false,
      enableMaxRate: false,
      enableOauth: false,
      useQueryParamAuth: false,
      enableMetamcpAdminTools: false,
      createMcpServer: false,
    });

    it("requires manage on the namespace and keeps authentication on for non-admins", async () => {
      const admin = await createUser("admin");
      const editor = await createUser("editor");
      const orgNamespace = await createNamespace(null);
      await share("namespace", orgNamespace.uuid, { userId: editor }, "use");

      const denied = await endpointsImplementations.create(
        endpointInput(orgNamespace.uuid, "ep-denied"),
        await principal(editor),
      );
      expect(denied.success).toBe(false);

      const own = await createNamespace(editor);
      const open = await endpointsImplementations.create(
        { ...endpointInput(own.uuid, "ep-open"), enableApiKeyAuth: false },
        await principal(editor),
      );
      expect(open.success).toBe(false);

      const adminTools = await endpointsImplementations.create(
        {
          ...endpointInput(own.uuid, "ep-tools"),
          enableMetamcpAdminTools: true,
        },
        await principal(editor),
      );
      expect(adminTools.success).toBe(false);

      const ok = await endpointsImplementations.create(
        endpointInput(own.uuid, "ep-ok"),
        await principal(editor),
      );
      expect(ok.success).toBe(true);

      const adminOpen = await endpointsImplementations.create(
        {
          ...endpointInput(orgNamespace.uuid, "ep-admin"),
          enableApiKeyAuth: false,
        },
        await principal(admin),
      );
      expect(adminOpen.success).toBe(true);

      // Visible to the editor through the namespace share, read-only
      const list = await endpointsImplementations.list(await principal(editor));
      const adminEndpoint = list.data.find(
        (endpoint) => endpoint.name === "ep-admin",
      );
      expect(adminEndpoint?.access?.level).toBe("use");
    });
  });

  describe("sharing", () => {
    it("only lets admins give more than use access to everyone", async () => {
      const editor = await createUser("editor");
      const server = await createServer(editor);
      const result = await sharesImplementations.upsert(
        {
          resourceType: "mcp_server",
          resourceUuid: server.uuid,
          subjectType: "group",
          subjectId: (await everyone()).uuid,
          level: "edit",
        },
        await principal(editor),
      );
      expect(result.success).toBe(false);
    });

    it("requires manage access and the share capability", async () => {
      const owner = await createUser("editor");
      const other = await createUser("editor");
      const viewer = await createUser("viewer");
      const server = await createServer(owner);
      await share("mcp_server", server.uuid, { userId: other }, "edit");

      const byEditor = await sharesImplementations.upsert(
        {
          resourceType: "mcp_server",
          resourceUuid: server.uuid,
          subjectType: "user",
          subjectId: viewer,
          level: "use",
        },
        await principal(other),
      );
      expect(byEditor.success).toBe(false);

      await share("mcp_server", server.uuid, { userId: viewer }, "manage");
      const byViewer = await sharesImplementations.upsert(
        {
          resourceType: "mcp_server",
          resourceUuid: server.uuid,
          subjectType: "user",
          subjectId: other,
          level: "use",
        },
        await principal(viewer),
      );
      // Viewers lack the "resources.share" capability by default
      expect(byViewer.success).toBe(false);

      const listing = await sharesImplementations.list(
        { resourceType: "mcp_server", resourceUuid: server.uuid },
        await principal(owner),
      );
      expect(listing?.canManage).toBe(true);
      expect(listing?.shares.map((row) => row.level).sort()).toEqual([
        "edit",
        "manage",
      ]);
    });

    it("upserts instead of duplicating shares", async () => {
      const owner = await createUser("editor");
      const other = await createUser("editor");
      const server = await createServer(owner);
      const input = {
        resourceType: "mcp_server" as const,
        resourceUuid: server.uuid,
        subjectType: "user" as const,
        subjectId: other,
      };
      await sharesImplementations.upsert(
        { ...input, level: "use" },
        await principal(owner),
      );
      await sharesImplementations.upsert(
        { ...input, level: "edit" },
        await principal(owner),
      );
      const listing = await sharesImplementations.list(
        { resourceType: "mcp_server", resourceUuid: server.uuid },
        await principal(owner),
      );
      expect(listing?.shares).toHaveLength(1);
      expect(listing?.shares[0].level).toBe("edit");
    });
  });

  describe("administration safety", () => {
    it("never leaves the instance without an active administrator", async () => {
      const onlyAdmin = await createUser("admin");
      const p = await principal(onlyAdmin);

      const demote = await adminImplementations.users.update(
        { id: onlyAdmin, baseRole: "viewer" },
        p,
      );
      expect(demote.success).toBe(false);

      const second = await createUser("viewer");
      const admins = await adminsGroup();
      await groupsRepository.addMembers(admins.uuid, [second], "manual");

      const demoteNow = await adminImplementations.users.update(
        { id: onlyAdmin, baseRole: "viewer" },
        p,
      );
      expect(demoteNow.success).toBe(true);

      const removeLast = await adminImplementations.groups.removeMember(
        { groupUuid: admins.uuid, userId: second },
        p,
      );
      expect(removeLast.success).toBe(false);

      const disableSelf = await adminImplementations.users.setDisabled(
        { id: second, disabled: true },
        await principal(second),
      );
      expect(disableSelf.success).toBe(false);
    });

    it("protects system group invariants", async () => {
      const admin = await createUser("admin");
      const p = await principal(admin);
      const everyoneGroup = await everyone();
      expect(
        (
          await adminImplementations.groups.update(
            { uuid: everyoneGroup.uuid, role: "admin" },
            p,
          )
        ).success,
      ).toBe(false);
      expect(
        (
          await adminImplementations.groups.delete(
            { uuid: everyoneGroup.uuid },
            p,
          )
        ).success,
      ).toBe(false);
      const admins = await adminsGroup();
      expect(
        (
          await adminImplementations.groups.update(
            { uuid: admins.uuid, role: "editor" },
            p,
          )
        ).success,
      ).toBe(false);
    });

    it("creates users with a password even when sign-up is disabled", async () => {
      const admin = await createUser("admin");
      await db
        .insert(schema.configTable)
        .values({ id: "DISABLE_SIGNUP", value: "true" })
        .onConflictDoUpdate({
          target: schema.configTable.id,
          set: { value: "true" },
        });

      const result = await adminImplementations.users.create(
        {
          name: "Carol",
          email: "carol@example.com",
          password: "correct-horse-battery",
          baseRole: "editor",
          groupUuids: [],
        },
        await principal(admin),
      );
      expect(result.success).toBe(true);
      const list = await adminImplementations.users.list(
        { search: "carol", limit: 10, offset: 0 },
        await principal(admin),
      );
      expect(list.users[0].baseRole).toBe("editor");
      expect(list.users[0].authMethods).toContain("credential");
    });

    it("transfers resources to the organisation when deleting a user", async () => {
      const admin = await createUser("admin");
      const leaver = await createUser("editor");
      const server = await createServer(leaver);
      const namespace = await createNamespace(leaver, [server.uuid]);

      const result = await adminImplementations.users.delete(
        { id: leaver, transfer: { mode: "organization" } },
        await principal(admin),
      );
      expect(result.success).toBe(true);
      const [moved] = await db
        .select()
        .from(schema.namespacesTable)
        .where(sql`uuid = ${namespace.uuid}`);
      expect(moved.user_id).toBeNull();
    });

    it("filters users by effective role", async () => {
      const admin = await createUser("admin");
      const viaGroup = await createUser("viewer");
      await createUser("viewer");
      const editors = await createGroup("editor");
      await groupsRepository.addMembers(editors.uuid, [viaGroup], "manual");

      const result = await adminImplementations.users.list(
        { role: "editor", limit: 50, offset: 0 },
        await principal(admin),
      );
      expect(result.users.map((user) => user.id)).toEqual([viaGroup]);
    });
  });

  describe("OIDC group sync", () => {
    it("adds and removes OIDC memberships but keeps manual ones", async () => {
      const user = await createUser("viewer");
      const devs = await groupsRepository.create({
        name: "Developers",
        role: "editor",
        oidcGroups: ["/engineering/*"],
      });
      const manual = await groupsRepository.create({
        name: "Manual",
        oidcGroups: ["old-group"],
      });
      await groupsRepository.addMembers(manual.uuid, [user], "manual");

      await oidcSyncService.syncUser(user, ["/engineering/web"]);
      let groups = await groupsRepository.getMembershipsForUser(user);
      expect(groups.map((group) => [group.name, group.source]).sort()).toEqual([
        ["Developers", "oidc"],
        ["Manual", "manual"],
      ]);
      expect((await principal(user)).role).toBe("editor");

      await oidcSyncService.syncUser(user, ["sales"]);
      groups = await groupsRepository.getMembershipsForUser(user);
      expect(groups.map((group) => group.name)).toEqual(["Manual"]);

      // An absent claim leaves memberships untouched
      await oidcSyncService.syncUser(user, ["/engineering/api"]);
      await oidcSyncService.syncUser(user, null);
      groups = await groupsRepository.getMembershipsForUser(user);
      expect(groups.map((group) => group.name).sort()).toEqual([
        "Developers",
        "Manual",
      ]);
      void devs;
    });

    it("can require at least one mapped group", async () => {
      await groupsRepository.create({
        name: "Allowed",
        oidcGroups: ["metamcp-users"],
      });
      expect(await oidcSyncService.isLoginAllowed(["random"])).toBe(true);
      await accessSettings.setOidcSettings({ requireGroupMatch: true });
      expect(await oidcSyncService.isLoginAllowed(["random"])).toBe(false);
      expect(await oidcSyncService.isLoginAllowed(null)).toBe(false);
      expect(await oidcSyncService.isLoginAllowed(["METAMCP-USERS"])).toBe(
        true,
      );
    });
  });

  describe("API keys and audit logs", () => {
    it("hides organisation keys from non-admins and rejects keys of disabled users", async () => {
      const admin = await createUser("admin");
      const user = await createUser("viewer");
      const repo = new ApiKeysRepository();
      await repo.create({ name: "org", user_id: null, is_active: true });
      const own = await apiKeysImplementations.create(
        { name: "mine" },
        await principal(user),
      );

      const userKeys = await apiKeysImplementations.list(await principal(user));
      expect(userKeys.apiKeys.map((key) => key.name)).toEqual(["mine"]);
      const adminKeys = await apiKeysImplementations.list(
        await principal(admin),
      );
      expect(adminKeys.apiKeys.map((key) => key.name)).toContain("org");

      await expect(
        apiKeysImplementations.create(
          { name: "org2", user_id: null },
          await principal(user),
        ),
      ).rejects.toThrow();

      expect((await repo.validateApiKey(own.key)).valid).toBe(true);
      await adminImplementations.users.setDisabled(
        { id: user, disabled: true },
        await principal(admin),
      );
      expect((await repo.validateApiKey(own.key)).valid).toBe(false);
    });

    it("shows non-admins only their own tool calls", async () => {
      const admin = await createUser("admin");
      const user = await createUser("viewer");
      const base = {
        endpoint_name: "ep",
        session_id: "s",
        tool_name: "t",
        status: "SUCCESS" as const,
        duration_ms: 1,
      };
      await db.insert(schema.mcpRequestAuditLogsTable).values([
        { ...base, auth_method: "api_key", api_key_user_id: user },
        { ...base, auth_method: "oauth", oauth_user_id: admin },
        { ...base, auth_method: "none" },
      ]);

      const mine = await mcpRequestAuditLogsImplementations.list(
        { limit: 50, offset: 0 },
        await principal(user),
      );
      expect(mine.logs).toHaveLength(1);
      expect(mine.totalCount).toBe(1);
      const all = await mcpRequestAuditLogsImplementations.list(
        { limit: 50, offset: 0 },
        await principal(admin),
      );
      expect(all.logs).toHaveLength(3);
    });
  });
});
