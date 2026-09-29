/**
 * Encryption at rest and credential hashing against a real, migrated Postgres.
 * Run with: INTEGRATION_DATABASE_URL=... pnpm --filter backend test:integration
 */
import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("secrets at rest (integration)", async () => {
  const { db, pool } = await import("../../db/index");
  const schema = await import("../../db/schema");
  const { SecretsService } = await import("./secrets.service");
  const { clearKeyring, encryptedWithKeyId, getActiveKeyId } =
    await import("./keyring");
  const { hashToken } = await import("./token-hash");
  const { ApiKeysRepository } =
    await import("../../db/repositories/api-keys.repo");
  const { oauthRepository } = await import("../../db/repositories");

  const originalKey = process.env.SECRETS_ENCRYPTION_KEY;
  let service = new SecretsService();

  async function raw<T>(query: ReturnType<typeof sql>) {
    return (await db.execute(query)).rows as T[];
  }

  async function reset() {
    await db.execute(sql`
      TRUNCATE TABLE oauth_sessions, mcp_servers, api_keys, oauth_access_tokens,
        oauth_authorization_codes, oauth_clients, users, encryption_keys
      RESTART IDENTITY CASCADE
    `);
  }

  async function restart(env: Record<string, string | undefined> = {}) {
    service.stop();
    clearKeyring();
    Object.assign(process.env, env);
    service = new SecretsService();
    await service.initialize();
  }

  beforeAll(async () => {
    await reset();
  });

  beforeEach(async () => {
    await reset();
    await restart({ SECRETS_ENCRYPTION_KEY: originalKey });
  });

  afterAll(async () => {
    service.stop();
    process.env.SECRETS_ENCRYPTION_KEY = originalKey;
    await pool.end();
  });

  async function createServer() {
    const [server] = await db
      .insert(schema.mcpServersTable)
      .values({
        name: `srv-${randomBytes(3).toString("hex")}`,
        type: "STREAMABLE_HTTP",
        url: "https://mcp.example.com/sse?token=url-secret",
        args: ["--dsn", "postgres://app:db-password@db/app"],
        env: { GITHUB_TOKEN: "ghp_env_secret", EMPTY: "" },
        bearerToken: "bearer-secret",
        headers: { Authorization: "Basic header-secret" },
      })
      .returning();
    return server;
  }

  type RawServer = {
    uuid: string;
    url: string | null;
    args: string[];
    env: Record<string, string>;
    bearer_token: string | null;
    headers: Record<string, string>;
  };

  it("stores MCP server secrets encrypted and reads them back in clear", async () => {
    const created = await createServer();
    expect(created.env.GITHUB_TOKEN).toBe("ghp_env_secret");

    const [stored] = await raw<RawServer>(
      sql`select uuid, url, args, env, bearer_token, headers from mcp_servers`,
    );
    const dump = JSON.stringify(stored);
    for (const secret of [
      "url-secret",
      "db-password",
      "ghp_env_secret",
      "bearer-secret",
      "header-secret",
    ]) {
      expect(dump).not.toContain(secret);
    }
    // Names stay readable, empty values are not encrypted.
    expect(Object.keys(stored.env).sort()).toEqual(["EMPTY", "GITHUB_TOKEN"]);
    expect(stored.env.EMPTY).toBe("");
    expect(encryptedWithKeyId(stored.url)).toBe(getActiveKeyId());

    const [read] = await db
      .select()
      .from(schema.mcpServersTable)
      .where(eq(schema.mcpServersTable.uuid, created.uuid));
    expect(read.url).toBe("https://mcp.example.com/sse?token=url-secret");
    expect(read.args).toEqual(["--dsn", "postgres://app:db-password@db/app"]);
    expect(read.bearerToken).toBe("bearer-secret");
    expect(read.headers).toEqual({ Authorization: "Basic header-secret" });
  });

  it("encrypts legacy clear-text rows at startup", async () => {
    await db.execute(sql`
      insert into mcp_servers (name, type, command, args, env)
      values ('legacy', 'STDIO', 'npx', ARRAY['--token', 'legacy-arg'], '{"KEY":"legacy-env"}'::jsonb)
    `);
    await db.execute(sql`
      insert into oauth_sessions (mcp_server_uuid, client_information, tokens, code_verifier)
      select uuid, '{"client_id":"c","client_secret":"legacy-client-secret"}'::jsonb,
             '{"access_token":"legacy-access-token"}'::jsonb, 'legacy-verifier'
      from mcp_servers where name = 'legacy'
    `);
    // Clear text is still readable before the sweep.
    const [before] = await db
      .select()
      .from(schema.mcpServersTable)
      .where(eq(schema.mcpServersTable.name, "legacy"));
    expect(before.env).toEqual({ KEY: "legacy-env" });

    await restart();

    const dump =
      JSON.stringify(await raw(sql`select args, env from mcp_servers`)) +
      JSON.stringify(await raw(sql`select * from oauth_sessions`));
    expect(dump).not.toContain("legacy-arg");
    expect(dump).not.toContain("legacy-env");
    expect(dump).not.toContain("legacy-client-secret");
    expect(dump).not.toContain("legacy-access-token");
    expect(dump).not.toContain("legacy-verifier");

    const [session] = await db.select().from(schema.oauthSessionsTable);
    expect(session.tokens).toEqual({ access_token: "legacy-access-token" });
    expect(session.client_information).toMatchObject({
      client_secret: "legacy-client-secret",
    });
    expect(session.code_verifier).toBe("legacy-verifier");

    const status = await service.getStatus();
    expect(status.plaintextValues).toBe(0);
  });

  it("rotates the data key and re-encrypts every value", async () => {
    const created = await createServer();
    const firstKey = getActiveKeyId();

    const { keyId } = await service.rotateDataKey();
    expect(keyId).not.toBe(firstKey);
    expect(getActiveKeyId()).toBe(keyId); // activation delay is 0 in tests
    await service.sweep();

    const [stored] = await raw<RawServer>(
      sql`select uuid, url, args, env, bearer_token, headers from mcp_servers`,
    );
    expect(encryptedWithKeyId(stored.url)).toBe(keyId);
    expect(encryptedWithKeyId(stored.env.GITHUB_TOKEN)).toBe(keyId);

    const [read] = await db
      .select()
      .from(schema.mcpServersTable)
      .where(eq(schema.mcpServersTable.uuid, created.uuid));
    expect(read.env.GITHUB_TOKEN).toBe("ghp_env_secret");

    const status = await service.getStatus();
    expect(status.keys.map((key) => key.state).sort()).toEqual([
      "active",
      "retired",
    ]);
    expect(status.keys.find((key) => key.state === "retired")?.values).toBe(0);
  });

  it("re-wraps data keys when the key encryption key changes", async () => {
    await createServer();
    const [before] = await db.select().from(schema.encryptionKeysTable);

    const newKey = randomBytes(32).toString("base64");
    await restart({
      SECRETS_ENCRYPTION_KEY: newKey,
      SECRETS_ENCRYPTION_KEY_PREVIOUS: originalKey,
    });
    const [after] = await db.select().from(schema.encryptionKeysTable);
    expect(after.id).toBe(before.id);
    expect(after.kek_id).not.toBe(before.kek_id);

    // The old key is no longer needed once the data key is re-wrapped.
    await restart({
      SECRETS_ENCRYPTION_KEY: newKey,
      SECRETS_ENCRYPTION_KEY_PREVIOUS: "",
    });
    const [read] = await db.select().from(schema.mcpServersTable);
    expect(read.bearerToken).toBe("bearer-secret");

    // Without the key that wraps the data key, startup is refused.
    service.stop();
    clearKeyring();
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await expect(new SecretsService().initialize()).rejects.toThrow(
      /not configured/,
    );
    process.env.SECRETS_ENCRYPTION_KEY = originalKey;
    delete process.env.SECRETS_ENCRYPTION_KEY_PREVIOUS;
  });

  it("stores only digests of API keys", async () => {
    const repository = new ApiKeysRepository();
    const created = await repository.create({
      name: "ci",
      user_id: null,
      is_active: true,
    });
    expect(created.key).toMatch(/^sk_mt_[A-Za-z0-9]{64}$/);
    expect(created.key_preview).toBe(
      `${created.key.slice(0, 10)}…${created.key.slice(-4)}`,
    );

    const [stored] = await raw<Record<string, unknown>>(
      sql`select * from api_keys`,
    );
    expect(JSON.stringify(stored)).not.toContain(created.key);
    expect(stored.key_hash).toBe(hashToken(created.key));

    await expect(repository.validateApiKey(created.key)).resolves.toMatchObject(
      { valid: true, key_uuid: created.uuid },
    );
    await expect(
      repository.validateApiKey(`${created.key.slice(0, -1)}x`),
    ).resolves.toEqual({ valid: false });
  });

  it("stores only digests of OAuth codes, tokens and client secrets", async () => {
    await db.insert(schema.usersTable).values({
      id: "oauth-user",
      name: "OAuth user",
      email: "oauth-user@example.com",
      emailVerified: true,
      role: "viewer",
    });
    await oauthRepository.upsertClient({
      client_id: "client-1",
      client_secret: "client-secret-value",
      client_name: "Client",
      redirect_uris: ["http://localhost/cb"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "admin",
      created_at: new Date(),
    });
    await oauthRepository.setAuthCode("code-value", {
      client_id: "client-1",
      redirect_uri: "http://localhost/cb",
      scope: "admin",
      user_id: "oauth-user",
      expires_at: Date.now() + 60_000,
    });
    await oauthRepository.setAccessToken("mcp_token_value", {
      client_id: "client-1",
      user_id: "oauth-user",
      scope: "admin",
      expires_at: Date.now() + 60_000,
      refresh_token: "refresh-value",
      refresh_token_expires_at: Date.now() + 120_000,
    });

    const dump = JSON.stringify([
      ...(await raw(sql`select * from oauth_clients`)),
      ...(await raw(sql`select * from oauth_authorization_codes`)),
      ...(await raw(sql`select * from oauth_access_tokens`)),
    ]);
    for (const secret of [
      "client-secret-value",
      "code-value",
      "mcp_token_value",
      "refresh-value",
    ]) {
      expect(dump).not.toContain(secret);
    }

    expect(await oauthRepository.getAuthCode("code-value")).not.toBeNull();
    const token = await oauthRepository.getAccessToken("mcp_token_value");
    expect(token?.user_id).toBe("oauth-user");
    const byRefresh = await oauthRepository.getByRefreshToken("refresh-value");
    expect(byRefresh?.access_token).toBe(hashToken("mcp_token_value"));

    await oauthRepository.deleteAccessTokenByHash(
      byRefresh?.access_token ?? "",
    );
    expect(await oauthRepository.getAccessToken("mcp_token_value")).toBeNull();
  });
});
