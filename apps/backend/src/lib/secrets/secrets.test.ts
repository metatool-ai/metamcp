import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pickActiveKey } from "./active-key";
import {
  createProviders,
  deriveKeyFromAuthSecret,
  KeyUnavailableError,
  LocalKekProvider,
  OpenBaoTransitProvider,
  parseKeyMaterial,
  SecretsConfigError,
  TransientKeyError,
} from "./kek-providers";
import {
  clearKeyring,
  decryptSecret,
  decryptSecretJson,
  decryptSecretMap,
  encryptedWithKeyId,
  encryptSecret,
  encryptSecretJson,
  encryptSecretMap,
  installKeyring,
  isEncryptedSecret,
  SecretDecryptionError,
  SecretsNotReadyError,
} from "./keyring";
import { hashToken, matchesTokenHash, previewApiKey } from "./token-hash";

/** Narrows away null for providers built from valid keys. */
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing value");
  return value;
}

const keyA = randomBytes(32);
const keyB = randomBytes(32);

function useKeys(activeKeyId: string, keys: Record<string, Buffer>) {
  installKeyring({ activeKeyId, keys: new Map(Object.entries(keys)) });
}

afterEach(() => clearKeyring());

describe("keyring", () => {
  it("round-trips secrets with a fresh IV every time", () => {
    useKeys("k_a", { k_a: keyA });
    const first = encryptSecret("ghp_secret", "mcp_servers.env:GITHUB_TOKEN");
    const second = encryptSecret("ghp_secret", "mcp_servers.env:GITHUB_TOKEN");
    expect(first).toMatch(/^enc:v1:k_a:/);
    expect(first).not.toContain("ghp_secret");
    expect(first).not.toBe(second);
    expect(decryptSecret(first, "mcp_servers.env:GITHUB_TOKEN")).toBe(
      "ghp_secret",
    );
    expect(encryptedWithKeyId(first)).toBe("k_a");
  });

  it("binds a value to the field it was written to", () => {
    useKeys("k_a", { k_a: keyA });
    const value = encryptSecret("token", "mcp_servers.bearer_token");
    expect(() => decryptSecret(value, "mcp_servers.url")).toThrow(
      SecretDecryptionError,
    );
  });

  it("detects tampering and unknown keys", () => {
    useKeys("k_a", { k_a: keyA });
    const value = encryptSecret("token", "ctx");
    const tampered = value.slice(0, -2) + (value.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, "ctx")).toThrow(SecretDecryptionError);

    useKeys("k_b", { k_b: keyB });
    expect(() => decryptSecret(value, "ctx")).toThrow(/unknown data key/);
  });

  it("keeps decrypting values of older keys after a rotation", () => {
    useKeys("k_a", { k_a: keyA });
    const old = encryptSecret("old", "ctx");
    useKeys("k_b", { k_a: keyA, k_b: keyB });
    const fresh = encryptSecret("new", "ctx");
    expect(encryptedWithKeyId(fresh)).toBe("k_b");
    expect(decryptSecret(old, "ctx")).toBe("old");
    expect(decryptSecret(fresh, "ctx")).toBe("new");
  });

  it("reads legacy plaintext as-is and leaves empty values alone", () => {
    expect(decryptSecret("plain", "ctx")).toBe("plain");
    useKeys("k_a", { k_a: keyA });
    expect(encryptSecret("", "ctx")).toBe("");
    expect(isEncryptedSecret("plain")).toBe(false);
    expect(encryptedWithKeyId("plain")).toBeNull();
  });

  it("fails closed when keys are not loaded", () => {
    expect(() => encryptSecret("x", "ctx")).toThrow(SecretsNotReadyError);
    useKeys("k_a", { k_a: keyA });
    const value = encryptSecret("x", "ctx");
    clearKeyring();
    expect(() => decryptSecret(value, "ctx")).toThrow(SecretsNotReadyError);
  });

  it("encrypts map values one by one, bound to their names", () => {
    useKeys("k_a", { k_a: keyA });
    const stored = encryptSecretMap({ A: "1", B: "2", EMPTY: "" }, "env");
    expect(Object.keys(stored)).toEqual(["A", "B", "EMPTY"]);
    expect(stored.EMPTY).toBe("");
    expect(decryptSecretMap(stored, "env")).toEqual({
      A: "1",
      B: "2",
      EMPTY: "",
    });

    const swapped = { A: stored.B, B: stored.A };
    expect(() => decryptSecretMap(swapped, "env")).toThrow(
      SecretDecryptionError,
    );
  });

  it("encrypts JSON documents and reads legacy objects", () => {
    useKeys("k_a", { k_a: keyA });
    const tokens = { access_token: "at", refresh_token: "rt" };
    const stored = encryptSecretJson(tokens, "oauth_sessions.tokens");
    expect(typeof stored).toBe("string");
    expect(decryptSecretJson(stored, "oauth_sessions.tokens")).toEqual(tokens);
    expect(decryptSecretJson(tokens, "oauth_sessions.tokens")).toEqual(tokens);
  });
});

describe("local key encryption key", () => {
  it("accepts 32-byte keys in hex, base64 and base64url", () => {
    const raw = randomBytes(32);
    expect(parseKeyMaterial(raw.toString("hex"), "K")).toEqual(raw);
    expect(parseKeyMaterial(raw.toString("base64"), "K")).toEqual(raw);
    expect(parseKeyMaterial(raw.toString("base64url"), "K")).toEqual(raw);
    expect(() => parseKeyMaterial("too-short", "K")).toThrow(
      SecretsConfigError,
    );
  });

  it("wraps with the primary key and unwraps with previous keys", async () => {
    const oldProvider = required(
      LocalKekProvider.fromKeys({ dedicated: keyA }),
    );
    const dataKey = randomBytes(32);
    const wrapped = await oldProvider.wrap(dataKey, "k_1");

    const rotated = required(
      LocalKekProvider.fromKeys({ dedicated: keyB, previous: [keyA] }),
    );
    expect(rotated.currentKekId()).not.toBe(wrapped.kekId);
    await expect(
      rotated.unwrap(wrapped.wrapped, wrapped.kekId, "k_1"),
    ).resolves.toEqual(dataKey);
    // The data key id is authenticated.
    await expect(
      rotated.unwrap(wrapped.wrapped, wrapped.kekId, "k_2"),
    ).rejects.toThrow(KeyUnavailableError);

    const withoutOldKey = required(
      LocalKekProvider.fromKeys({ dedicated: keyB }),
    );
    await expect(
      withoutOldKey.unwrap(wrapped.wrapped, wrapped.kekId, "k_1"),
    ).rejects.toThrow(/not configured/);
  });

  it("prefers a dedicated key over the one derived from BETTER_AUTH_SECRET", () => {
    const derived = deriveKeyFromAuthSecret("auth-secret");
    expect(deriveKeyFromAuthSecret("auth-secret")).toEqual(derived);
    const provider = required(
      LocalKekProvider.fromKeys({ dedicated: keyA, derived }),
    );
    expect(provider.source).toBe("dedicated");
    expect(required(LocalKekProvider.fromKeys({ derived })).source).toBe(
      "derived",
    );
  });
});

describe("createProviders", () => {
  it("falls back to a derived key with a warning", () => {
    const setup = createProviders({ BETTER_AUTH_SECRET: "a-real-secret" });
    expect(setup.primary.name).toBe("local");
    expect(setup.primary.source).toBe("derived");
    expect(setup.warnings[0]).toMatch(/SECRETS_ENCRYPTION_KEY/);
  });

  it("warns loudly about the example BETTER_AUTH_SECRET", () => {
    const setup = createProviders({
      BETTER_AUTH_SECRET: "your-super-secret-key-change-this-in-production",
    });
    expect(setup.warnings[0]).toMatch(/public/);
  });

  it("uses a dedicated key without warnings", () => {
    const setup = createProviders({
      SECRETS_ENCRYPTION_KEY: keyA.toString("base64"),
      BETTER_AUTH_SECRET: "a-real-secret",
    });
    expect(setup.primary.source).toBe("dedicated");
    expect(setup.warnings).toEqual([]);
  });

  it("reads the dedicated key from SECRETS_ENCRYPTION_KEY_FILE", () => {
    const file = join(
      mkdtempSync(join(tmpdir(), "metamcp-kek-")),
      "secrets-encryption-key",
    );
    writeFileSync(file, `${keyA.toString("base64")}\n`, { mode: 0o600 });
    const fromFile = createProviders({
      SECRETS_ENCRYPTION_KEY_FILE: file,
      BETTER_AUTH_SECRET: "a-real-secret",
    });
    const fromEnv = createProviders({
      SECRETS_ENCRYPTION_KEY: keyA.toString("base64"),
      BETTER_AUTH_SECRET: "a-real-secret",
    });
    expect(fromFile.primary.source).toBe("dedicated");
    expect(fromFile.primary.currentKekId()).toBe(
      fromEnv.primary.currentKekId(),
    );
  });

  it("ignores a stray VAULT_ADDR without credentials with the local provider", () => {
    const setup = createProviders({
      VAULT_ADDR: "https://vault.example.com",
      SECRETS_ENCRYPTION_KEY: keyA.toString("base64"),
      BETTER_AUTH_SECRET: "a-real-secret",
    });
    expect(setup.primary.source).toBe("dedicated");
    expect(setup.warnings.join(" ")).toMatch(/VAULT_ADDR/);
    expect(() =>
      createProviders({
        SECRETS_PROVIDER: "openbao",
        OPENBAO_ADDR: "https://openbao.example.com",
        BETTER_AUTH_SECRET: "a-real-secret",
      }),
    ).toThrow(/credentials/);
  });

  it("rejects incomplete or unknown configurations", () => {
    expect(() => createProviders({})).toThrow(SecretsConfigError);
    expect(() =>
      createProviders({ SECRETS_PROVIDER: "kms", BETTER_AUTH_SECRET: "s" }),
    ).toThrow(/Unknown SECRETS_PROVIDER/);
    expect(() =>
      createProviders({ SECRETS_PROVIDER: "openbao", BETTER_AUTH_SECRET: "s" }),
    ).toThrow(/OPENBAO_ADDR/);
    expect(() =>
      createProviders({
        SECRETS_PROVIDER: "openbao",
        OPENBAO_ADDR: "http://bao:8200",
      }),
    ).toThrow(/credentials/);
  });

  it("keeps local keys as a fallback when switching to OpenBao", () => {
    const setup = createProviders({
      SECRETS_PROVIDER: "openbao",
      OPENBAO_ADDR: "http://bao:8200",
      OPENBAO_TOKEN: "t",
      BETTER_AUTH_SECRET: "a-real-secret",
    });
    expect(setup.primary.name).toBe("openbao");
    expect(setup.fallbacks.map((provider) => provider.name)).toEqual(["local"]);
  });
});

/** Minimal Transit engine: "encrypts" by base64-wrapping with a prefix. */
function fakeOpenBao(options: { status?: number; failNetwork?: boolean } = {}) {
  const calls: { path: string; headers: Record<string, string>; body: any }[] =
    [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (options.failNetwork) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({
      path: url.pathname,
      headers: init?.headers as Record<string, string>,
      body,
    });
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (options.status) return json(options.status, { errors: ["sealed"] });
    if (url.pathname === "/v1/auth/approle/login") {
      return json(200, {
        auth: { client_token: "login-token", lease_duration: 600 },
      });
    }
    if (url.pathname.endsWith("/encrypt/metamcp")) {
      return json(200, {
        data: {
          ciphertext: `vault:v1:${Buffer.from(body.plaintext, "base64").toString("base64")}`,
        },
      });
    }
    if (url.pathname.endsWith("/decrypt/metamcp")) {
      return json(200, {
        data: { plaintext: String(body.ciphertext).slice("vault:v1:".length) },
      });
    }
    return json(404, { errors: ["not found"] });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("OpenBao Transit key encryption key", () => {
  const config = {
    address: "http://bao:8200",
    namespace: "team",
    transitMount: "transit",
    transitKey: "metamcp",
    timeoutMs: 1000,
  };

  it("wraps and unwraps data keys with a static token", async () => {
    const { calls, fetchImpl } = fakeOpenBao();
    const provider = new OpenBaoTransitProvider(
      { ...config, auth: { method: "token", token: () => "s.token" } },
      fetchImpl,
    );
    const dataKey = randomBytes(32);
    const wrapped = await provider.wrap(dataKey, "k_1");
    expect(wrapped.kekId).toBe("openbao:transit/metamcp");
    await expect(
      provider.unwrap(wrapped.wrapped, wrapped.kekId, "k_1"),
    ).resolves.toEqual(dataKey);
    await expect(
      provider.unwrap(wrapped.wrapped, wrapped.kekId, "k_2"),
    ).rejects.toThrow(/does not belong/);
    expect(calls[0].headers["X-Vault-Token"]).toBe("s.token");
    expect(calls[0].headers["X-Vault-Namespace"]).toBe("team");
  });

  it("logs in with AppRole once and reuses the token", async () => {
    const { calls, fetchImpl } = fakeOpenBao();
    const provider = new OpenBaoTransitProvider(
      {
        ...config,
        auth: {
          method: "approle",
          mount: "approle",
          roleId: "role",
          secretId: () => "secret",
        },
      },
      fetchImpl,
    );
    await provider.wrap(randomBytes(32), "k_1");
    await provider.wrap(randomBytes(32), "k_2");
    const logins = calls.filter((call) => call.path.includes("/login"));
    expect(logins).toHaveLength(1);
    expect(logins[0].body).toEqual({ role_id: "role", secret_id: "secret" });
    expect(calls[1].headers["X-Vault-Token"]).toBe("login-token");
  });

  it("reports sealed or unreachable OpenBao as transient", async () => {
    const auth = { method: "token" as const, token: () => "t" };
    await expect(
      new OpenBaoTransitProvider(
        { ...config, auth },
        fakeOpenBao({ status: 503 }).fetchImpl,
      ).wrap(randomBytes(32), "k_1"),
    ).rejects.toThrow(TransientKeyError);
    await expect(
      new OpenBaoTransitProvider(
        { ...config, auth },
        fakeOpenBao({ failNetwork: true }).fetchImpl,
      ).wrap(randomBytes(32), "k_1"),
    ).rejects.toThrow(TransientKeyError);
  });
});

describe("token digests", () => {
  it("stores and verifies SHA-256 digests", () => {
    const digest = hashToken("sk_mt_abc");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(matchesTokenHash("sk_mt_abc", digest)).toBe(true);
    expect(matchesTokenHash("sk_mt_abd", digest)).toBe(false);
    expect(matchesTokenHash(undefined, digest)).toBe(false);
    expect(matchesTokenHash("sk_mt_abc", null)).toBe(false);
  });

  it("previews keys without revealing them", () => {
    const key = `sk_mt_${"a".repeat(30)}WXYZ`;
    expect(previewApiKey(key)).toBe("sk_mt_aaaa…WXYZ");
  });
});

describe("pickActiveKey", () => {
  const at = (iso: string) => new Date(iso);
  const now = at("2026-09-28T12:00:00Z");

  it("picks the newest activated key", () => {
    const rows = [
      { id: "a", activated_at: at("2026-01-01T00:00:00Z") },
      { id: "b", activated_at: at("2026-09-01T00:00:00Z") },
      { id: "pending", activated_at: at("2026-09-28T12:05:00Z") },
    ];
    expect(pickActiveKey(rows, now)?.id).toBe("b");
  });

  it("falls back to the earliest key when none is activated yet", () => {
    const rows = [{ id: "future", activated_at: at("2026-09-28T12:01:00Z") }];
    expect(pickActiveKey(rows, now)?.id).toBe("future");
  });
});
