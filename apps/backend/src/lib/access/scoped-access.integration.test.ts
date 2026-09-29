/**
 * Integration tests (real Postgres) for endpoint-scoped API keys and the
 * access-control fixes of the security review: revoked shares cutting
 * namespace compositions, endpoint ownership, credential redistribution,
 * generated endpoint servers, OAuth consent and the secrets sweep.
 * Run with: INTEGRATION_DATABASE_URL=... pnpm --filter backend test:integration
 */
import type { AccessPrincipal, DatabaseEndpoint, Role } from "@repo/zod-types";
import { eq, sql } from "drizzle-orm";
import type express from "express";
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

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

describe.skipIf(!hasDatabase)("scoped access (integration)", async () => {
  const { db, pool } = await import("../../db/index");
  const schema = await import("../../db/schema");
  const { accessService } = await import("./access.service");
  const { clearAccessSettingsCache } = await import("./access-settings");
  const { groupsRepository } =
    await import("../../db/repositories/groups.repo");
  const { resourceSharesRepository } =
    await import("../../db/repositories/resource-shares.repo");
  const { ApiKeysRepository } =
    await import("../../db/repositories/api-keys.repo");
  const { apiKeysImplementations } = await import("../../trpc/api-keys.impl");
  const { endpointsImplementations } =
    await import("../../trpc/endpoints.impl");
  const { sharesImplementations } = await import("../../trpc/shares.impl");
  const { oauthConsentImplementations } =
    await import("../../trpc/oauth-consent.impl");
  const { authenticateApiKey } =
    await import("../../middleware/api-key-oauth.middleware");
  const { buildAdminToolsOptions } =
    await import("../admin-mcp/build-admin-tools-options");
  const { allowedNamespaceServers } = await import("./namespace-composition");
  const { endpointAccessCache } = await import("./endpoint-access-cache");
  const { encodeAuthorizationRequest, validateAuthorizationRequest } =
    await import("../oauth/authorization-request");
  const { oauthRepository } = await import("../../db/repositories");
  const { secretsService } = await import("../secrets/secrets.service");

  const apiKeysRepository = new ApiKeysRepository();
  let seq = 0;

  async function resetDatabase() {
    await db.execute(sql`
      TRUNCATE TABLE
        mcp_request_audit_logs, resource_shares, group_members,
        namespace_tool_mappings, namespace_server_mappings, tools,
        api_key_endpoints, endpoints, namespaces, oauth_sessions,
        mcp_servers, api_keys, oauth_access_tokens,
        oauth_authorization_codes, oauth_clients, sessions, accounts, users,
        config
      RESTART IDENTITY CASCADE
    `);
    await db.execute(sql`DELETE FROM groups WHERE system_key IS NULL`);
    await groupsRepository.ensureSystemGroups();
    accessService.invalidateAll();
    clearAccessSettingsCache();
  }

  async function createUser(role: Role) {
    const id = `user-${++seq}-${Date.now()}`;
    await db.insert(schema.usersTable).values({
      id,
      name: id,
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
    values: Partial<typeof schema.mcpServersTable.$inferInsert> = {},
  ) {
    const [server] = await db
      .insert(schema.mcpServersTable)
      .values({
        name: `srv${++seq}`,
        type: "STREAMABLE_HTTP",
        url: `https://mcp${seq}.example.com/mcp`,
        user_id: ownerId,
        ...values,
      })
      .returning();
    return must(server);
  }

  async function createNamespace(ownerId: string | null, servers: string[]) {
    const [namespace] = await db
      .insert(schema.namespacesTable)
      .values({ name: `ns${++seq}`, user_id: ownerId })
      .returning();
    if (servers.length > 0) {
      await db.insert(schema.namespaceServerMappingsTable).values(
        servers.map((uuid) => ({
          namespace_uuid: must(namespace).uuid,
          mcp_server_uuid: uuid,
        })),
      );
    }
    return must(namespace);
  }

  async function createEndpoint(
    namespaceUuid: string,
    ownerId: string | null,
    values: Partial<typeof schema.endpointsTable.$inferInsert> = {},
  ): Promise<DatabaseEndpoint> {
    const [endpoint] = await db
      .insert(schema.endpointsTable)
      .values({
        name: `ep${++seq}`,
        namespace_uuid: namespaceUuid,
        user_id: ownerId,
        enable_api_key_auth: true,
        ...values,
      })
      .returning();
    return endpoint as DatabaseEndpoint;
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

  async function unshare(
    type: "mcp_server" | "namespace",
    resourceUuid: string,
  ) {
    await db
      .delete(schema.resourceSharesTable)
      .where(
        type === "mcp_server"
          ? eq(schema.resourceSharesTable.mcp_server_uuid, resourceUuid)
          : eq(schema.resourceSharesTable.namespace_uuid, resourceUuid),
      );
    accessService.invalidateAll();
  }

  /** Runs the MCP authentication middleware for a key on an endpoint. */
  async function authenticate(key: string, endpoint: DatabaseEndpoint) {
    const req = {
      headers: { "x-api-key": key },
      query: {},
      endpoint,
      endpointName: endpoint.name,
      namespaceUuid: endpoint.namespace_uuid,
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as express.Request;
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
      set() {
        return this;
      },
    } as unknown as express.Response;
    let passed = false;
    await authenticateApiKey(req, res, () => {
      passed = true;
    });
    return {
      passed,
      status,
      req: req as express.Request & { apiKeyScope?: string },
    };
  }

  beforeAll(async () => {
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

  describe("endpoint-scoped API keys", () => {
    it("only work on their endpoints and never reach the admin tools", async () => {
      const bob = await createUser("editor");
      const mine = await createNamespace(bob, []);
      const other = await createNamespace(bob, []);
      const allowed = await createEndpoint(mine.uuid, bob, {
        enable_metamcp_admin_tools: true,
      });
      const elsewhere = await createEndpoint(other.uuid, bob);

      const scoped = await apiKeysImplementations.create(
        {
          name: "scoped",
          scope: "endpoints",
          endpoint_uuids: [allowed.uuid],
        },
        await principal(bob),
      );
      const full = await apiKeysImplementations.create(
        { name: "full" },
        await principal(bob),
      );

      const ok = await authenticate(scoped.key, allowed);
      expect(ok.passed).toBe(true);
      expect(ok.req.apiKeyScope).toBe("endpoints");
      expect(await buildAdminToolsOptions(allowed, ok.req as never)).toBe(
        undefined,
      );

      const refused = await authenticate(scoped.key, elsewhere);
      expect(refused).toMatchObject({ passed: false, status: 403 });

      // A full key keeps working everywhere, admin tools included
      const fullOk = await authenticate(full.key, allowed);
      expect(fullOk.passed).toBe(true);
      expect(
        await buildAdminToolsOptions(allowed, fullOk.req as never),
      ).toEqual({ enabled: true, userId: bob });
    });

    it("are limited to endpoints their owner can reach, now and later", async () => {
      const alice = await createUser("editor");
      const bob = await createUser("editor");
      const privateNamespace = await createNamespace(alice, []);
      const sharedNamespace = await createNamespace(alice, []);
      const hidden = await createEndpoint(privateNamespace.uuid, alice);
      const shared = await createEndpoint(sharedNamespace.uuid, alice);
      await share("namespace", sharedNamespace.uuid, { userId: bob }, "use");

      await expect(
        apiKeysImplementations.create(
          {
            name: "sneaky",
            scope: "endpoints",
            endpoint_uuids: [hidden.uuid],
          },
          await principal(bob),
        ),
      ).rejects.toThrow(/cannot use/);

      const key = await apiKeysImplementations.create(
        { name: "shared", scope: "endpoints", endpoint_uuids: [shared.uuid] },
        await principal(bob),
      );
      expect((await authenticate(key.key, shared)).passed).toBe(true);

      await unshare("namespace", sharedNamespace.uuid);
      endpointAccessCache.clear();
      expect(await authenticate(key.key, shared)).toMatchObject({
        passed: false,
        status: 403,
      });
    });

    it("lets administrators dedicate organisation keys to endpoints", async () => {
      const admin = await createUser("admin");
      const namespace = await createNamespace(null, []);
      const endpoint = await createEndpoint(namespace.uuid, null);

      const dedicated = await apiKeysImplementations.create(
        {
          name: "service",
          user_id: null,
          scope: "endpoints",
          endpoint_uuids: [endpoint.uuid],
        },
        await principal(admin),
      );
      const plain = await apiKeysImplementations.create(
        { name: "org", user_id: null },
        await principal(admin),
      );

      expect((await authenticate(dedicated.key, endpoint)).passed).toBe(true);
      // Not shared with everyone: a plain organisation key is refused
      expect((await authenticate(plain.key, endpoint)).passed).toBe(false);
    });

    it("lets administrators list and revoke the keys of every user", async () => {
      const admin = await createUser("admin");
      const bob = await createUser("editor");
      const namespace = await createNamespace(bob, []);
      const endpoint = await createEndpoint(namespace.uuid, bob);
      const key = await apiKeysImplementations.create(
        { name: "bob", scope: "endpoints", endpoint_uuids: [endpoint.uuid] },
        await principal(bob),
      );

      const own = await apiKeysImplementations.list(await principal(admin));
      expect(own.apiKeys.some((row) => row.uuid === key.uuid)).toBe(false);

      const all = await apiKeysImplementations.list(await principal(admin), {
        allUsers: true,
      });
      const row = all.apiKeys.find((item) => item.uuid === key.uuid);
      expect(row).toMatchObject({
        scope: "endpoints",
        endpoints: [{ uuid: endpoint.uuid, name: endpoint.name }],
        owner: { id: bob },
      });

      // A non-admin asking for everything only gets their own keys
      const bobList = await apiKeysImplementations.list(await principal(bob), {
        allUsers: true,
      });
      expect(bobList.apiKeys.map((item) => item.uuid)).toEqual([key.uuid]);

      await apiKeysImplementations.update(
        { uuid: key.uuid, is_active: false },
        await principal(admin),
      );
      expect((await apiKeysRepository.validateApiKey(key.key)).valid).toBe(
        false,
      );

      // Back to a full key: the endpoint list goes away
      await apiKeysImplementations.update(
        { uuid: key.uuid, is_active: true, scope: "user" },
        await principal(bob),
      );
      const validation = await apiKeysRepository.validateApiKey(key.key);
      expect(validation).toMatchObject({ valid: true, scope: "user" });
      expect(validation.endpoint_uuids).toBeUndefined();
    });
  });

  describe("access-control fixes", () => {
    it("drops a server from namespaces built on a revoked share", async () => {
      const alice = await createUser("editor");
      const bob = await createUser("editor");
      const alicesServer = await createServer(alice);
      const bobsServer = await createServer(bob);
      await share("mcp_server", alicesServer.uuid, { userId: bob }, "use");
      const namespace = await createNamespace(bob, [
        alicesServer.uuid,
        bobsServer.uuid,
      ]);

      endpointAccessCache.clear();
      expect(
        [...((await allowedNamespaceServers(namespace.uuid)) ?? [])].sort(),
      ).toEqual([alicesServer.uuid, bobsServer.uuid].sort());

      // Shared with others: a use-only server may not be redistributed
      await share("namespace", namespace.uuid, { userId: alice }, "use");
      endpointAccessCache.clear();
      expect([
        ...((await allowedNamespaceServers(namespace.uuid)) ?? []),
      ]).toEqual([bobsServer.uuid]);

      await unshare("mcp_server", alicesServer.uuid);
      endpointAccessCache.clear();
      expect(
        (await allowedNamespaceServers(namespace.uuid))?.has(alicesServer.uuid),
      ).toBe(false);
    });

    it("does not let an endpoint owner in without access to its namespace", async () => {
      const alice = await createUser("editor");
      const bob = await createUser("editor");
      const namespace = await createNamespace(alice, []);
      await share("namespace", namespace.uuid, { userId: bob }, "manage");
      const endpoint = await createEndpoint(namespace.uuid, bob);
      const key = await apiKeysImplementations.create(
        { name: "bob" },
        await principal(bob),
      );
      expect((await authenticate(key.key, endpoint)).passed).toBe(true);

      await unshare("namespace", namespace.uuid);
      endpointAccessCache.clear();
      expect((await authenticate(key.key, endpoint)).passed).toBe(false);
    });

    it("refuses to share servers holding MetaMCP credentials beyond their reach", async () => {
      const alice = await createUser("editor");
      const bob = await createUser("editor");
      const everyoneGroup = await groupsRepository.findBySystemKey("everyone");
      const alicesServer = await createServer(alice);
      await share("mcp_server", alicesServer.uuid, { userId: bob }, "use");
      const namespace = await createNamespace(bob, [alicesServer.uuid]);
      const endpoint = await createEndpoint(namespace.uuid, bob);

      const fullKey = await apiKeysImplementations.create(
        { name: "full" },
        await principal(bob),
      );
      const withFullKey = await createServer(bob, {
        bearerToken: fullKey.key,
      });
      const refusedFull = await sharesImplementations.upsert(
        {
          resourceType: "mcp_server",
          resourceUuid: withFullKey.uuid,
          subjectType: "group",
          subjectId: must(everyoneGroup).uuid,
          level: "use",
        },
        await principal(bob),
      );
      expect(refusedFull.success).toBe(false);
      expect(refusedFull.message).toMatch(/personal MetaMCP API key/);

      // A key limited to an endpoint whose namespace holds a use-only server
      const scopedKey = await apiKeysImplementations.create(
        { name: "scoped", scope: "endpoints", endpoint_uuids: [endpoint.uuid] },
        await principal(bob),
      );
      const loopback = await createServer(bob, {
        headers: { Authorization: `Bearer ${scopedKey.key}` },
      });
      const refusedScoped = await sharesImplementations.upsert(
        {
          resourceType: "mcp_server",
          resourceUuid: loopback.uuid,
          subjectType: "group",
          subjectId: must(everyoneGroup).uuid,
          level: "use",
        },
        await principal(bob),
      );
      expect(refusedScoped.success).toBe(false);

      // An ordinary server of Bob's can be shared
      const plain = await createServer(bob);
      const allowed = await sharesImplementations.upsert(
        {
          resourceType: "mcp_server",
          resourceUuid: plain.uuid,
          subjectType: "group",
          subjectId: must(everyoneGroup).uuid,
          level: "use",
        },
        await principal(bob),
      );
      expect(allowed.success).toBe(true);
    });

    it("gives generated endpoint servers a key limited to that endpoint", async () => {
      const admin = await createUser("admin");
      const bob = await createUser("editor");
      const namespace = await createNamespace(bob, []);
      const created = await endpointsImplementations.create(
        {
          name: `generated${++seq}`,
          namespaceUuid: namespace.uuid,
          enableApiKeyAuth: true,
          enableClientMaxRate: false,
          enableMaxRate: false,
          enableOauth: false,
          useQueryParamAuth: false,
          enableMetamcpAdminTools: false,
          createMcpServer: true,
          user_id: bob,
        },
        await principal(admin),
      );
      expect(created.success).toBe(true);

      const [server] = await db
        .select()
        .from(schema.mcpServersTable)
        .where(
          eq(
            schema.mcpServersTable.name,
            `${must(created.data).name}-endpoint`,
          ),
        );
      expect(server?.bearerToken).toMatch(/^sk_mt_/);
      const validation = await apiKeysRepository.validateApiKey(
        must(must(server).bearerToken),
      );
      expect(validation).toMatchObject({
        valid: true,
        user_id: bob,
        scope: "endpoints",
        endpoint_uuids: [must(created.data).uuid],
      });
    });
  });

  describe("OAuth consent", () => {
    it("issues a code only when the signed-in user approves", async () => {
      const bob = await createUser("viewer");
      const clientId = `client-${++seq}`;
      await oauthRepository.upsertClient({
        client_id: clientId,
        client_secret: null,
        client_name: "Test client",
        redirect_uris: ["http://localhost:33418/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: "admin",
      } as never);
      const params = {
        client_id: clientId,
        redirect_uri: "http://localhost:33418/callback",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        state: "xyz",
      };

      const plain = await validateAuthorizationRequest({
        ...params,
        code_challenge_method: "plain",
      });
      expect(plain.ok).toBe(false);

      const request = encodeAuthorizationRequest(
        params as Parameters<typeof encodeAuthorizationRequest>[0],
      );
      const described = await oauthConsentImplementations.describe(
        { request },
        bob,
      );
      expect(described).toMatchObject({
        clientName: "Test client",
        redirectOrigin: "http://localhost:33418",
      });

      const denied = await oauthConsentImplementations.decide(
        { request, approve: false },
        bob,
      );
      expect(denied.redirectUrl).toContain("error=access_denied");
      expect(denied.redirectUrl).toContain("state=xyz");
      expect(denied.redirectUrl).not.toContain("code=");

      const approved = await oauthConsentImplementations.decide(
        { request, approve: true },
        bob,
      );
      const code = new URL(approved.redirectUrl).searchParams.get("code");
      expect(code).toMatch(/^mcp_code_/);
      const stored = await oauthRepository.getAuthCode(must(code));
      expect(stored).toMatchObject({
        user_id: bob,
        client_id: clientId,
        code_challenge_method: "S256",
      });
    });
  });

  describe("secrets sweep", () => {
    it("reports unreadable records instead of failing", async () => {
      const bob = await createUser("editor");
      const readable = await createServer(bob, { bearerToken: "plain" });
      await db.execute(
        sql`UPDATE mcp_servers SET bearer_token = ${"enc:v1:k_000000000000:AAAA"} WHERE uuid = ${(await createServer(bob)).uuid}`,
      );
      // Leave the readable one in clear text so the sweep has work to do
      await db.execute(
        sql`UPDATE mcp_servers SET bearer_token = ${"legacy-plain"} WHERE uuid = ${readable.uuid}`,
      );
      const result = await secretsService.sweep();
      expect(result.failed).toBe(1);
      expect(result.updated).toBeGreaterThanOrEqual(1);
    });
  });
});
