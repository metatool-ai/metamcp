import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { readFileSync } from "node:fs";

import { isPlaceholderSecret } from "../startup-checks";

/**
 * Key encryption keys (KEK): they wrap the data encryption keys stored in the
 * `encryption_keys` table and never touch the database themselves.
 *
 * - local: a 32-byte key from SECRETS_ENCRYPTION_KEY (recommended), or one
 *   derived from BETTER_AUTH_SECRET when no dedicated key is configured.
 * - openbao: the Transit secrets engine of OpenBao (or HashiCorp Vault). The
 *   master key stays in OpenBao; MetaMCP only asks it to wrap / unwrap its
 *   data keys (at startup, when a new data key appears, and on rotation).
 */

export type KekProviderName = "local" | "openbao";

export type KekSource = "dedicated" | "derived" | "openbao";

export interface WrappedDataKey {
  wrapped: string;
  kekProvider: KekProviderName;
  kekId: string;
}

export interface KeyEncryptionProvider {
  readonly name: KekProviderName;
  readonly source: KekSource;
  /** Identifier of the key material that wraps new data keys. */
  currentKekId(): string;
  wrap(dataKey: Buffer, dataKeyId: string): Promise<WrappedDataKey>;
  unwrap(wrapped: string, kekId: string, dataKeyId: string): Promise<Buffer>;
  /** Non-secret description shown to administrators. */
  describe(): Record<string, string>;
}

export class KeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyUnavailableError";
  }
}

/** OpenBao unreachable, sealed or overloaded: worth retrying. */
export class TransientKeyError extends KeyUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "TransientKeyError";
  }
}

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsConfigError";
  }
}

// ---------------------------------------------------------------------------
// Local key
// ---------------------------------------------------------------------------

const KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Decodes a 32-byte key given in hex, base64 or base64url. */
export function parseKeyMaterial(raw: string, variable: string): Buffer {
  const value = raw.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new SecretsConfigError(
      `${variable} must be ${KEY_BYTES} random bytes encoded in base64 or hex (generate one with: openssl rand -base64 32).`,
    );
  }
  return decoded;
}

/** Key derived from BETTER_AUTH_SECRET, used when no dedicated key is set. */
export function deriveKeyFromAuthSecret(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("metamcp-secrets-kek", "utf8"),
      Buffer.from("v1", "utf8"),
      KEY_BYTES,
    ),
  );
}

function fingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

type LocalKey = { key: Buffer; source: "dedicated" | "derived"; id: string };

export class LocalKekProvider implements KeyEncryptionProvider {
  readonly name = "local" as const;
  readonly source: "dedicated" | "derived";
  private readonly primary: LocalKey;
  private readonly candidates: LocalKey[];

  constructor(primary: LocalKey, candidates: LocalKey[]) {
    this.primary = primary;
    this.source = primary.source;
    this.candidates = candidates;
  }

  static fromKeys(keys: {
    dedicated?: Buffer;
    previous?: Buffer[];
    derived?: Buffer;
  }): LocalKekProvider | null {
    const toLocal = (key: Buffer, source: LocalKey["source"]): LocalKey => ({
      key,
      source,
      id: `local:${fingerprint(key)}`,
    });
    const dedicated = keys.dedicated
      ? toLocal(keys.dedicated, "dedicated")
      : undefined;
    const derived = keys.derived ? toLocal(keys.derived, "derived") : undefined;
    const primary = dedicated ?? derived;
    if (!primary) return null;

    const all = [
      dedicated,
      ...(keys.previous ?? []).map((key) => toLocal(key, "dedicated")),
      derived,
    ].filter((key): key is LocalKey => Boolean(key));
    const unique = [...new Map(all.map((key) => [key.id, key])).values()];
    return new LocalKekProvider(primary, unique);
  }

  currentKekId(): string {
    return this.primary.id;
  }

  async wrap(dataKey: Buffer, dataKeyId: string): Promise<WrappedDataKey> {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.primary.key, iv, {
      authTagLength: GCM_TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(`metamcp:dek:${dataKeyId}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return {
      wrapped: Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
        "base64url",
      ),
      kekProvider: "local",
      kekId: this.primary.id,
    };
  }

  async unwrap(
    wrapped: string,
    kekId: string,
    dataKeyId: string,
  ): Promise<Buffer> {
    const candidate = this.candidates.find((key) => key.id === kekId);
    if (!candidate) {
      throw new KeyUnavailableError(
        `data key ${dataKeyId} is wrapped by local key ${kekId}, which is not configured. Set it in SECRETS_ENCRYPTION_KEY or SECRETS_ENCRYPTION_KEY_PREVIOUS (or restore the BETTER_AUTH_SECRET it was derived from).`,
      );
    }
    const payload = Buffer.from(wrapped, "base64url");
    try {
      if (payload.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
        throw new Error("truncated wrapped key");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        candidate.key,
        payload.subarray(0, GCM_IV_BYTES),
        { authTagLength: GCM_TAG_BYTES },
      );
      decipher.setAAD(Buffer.from(`metamcp:dek:${dataKeyId}`, "utf8"));
      decipher.setAuthTag(payload.subarray(payload.length - GCM_TAG_BYTES));
      const key = Buffer.concat([
        decipher.update(
          payload.subarray(GCM_IV_BYTES, payload.length - GCM_TAG_BYTES),
        ),
        decipher.final(),
      ]);
      if (key.length !== KEY_BYTES) {
        throw new Error("unexpected data key length");
      }
      return key;
    } catch {
      throw new KeyUnavailableError(
        `data key ${dataKeyId} could not be unwrapped with local key ${kekId}.`,
      );
    }
  }

  describe(): Record<string, string> {
    return { keyId: this.primary.id };
  }
}

// ---------------------------------------------------------------------------
// OpenBao / Vault Transit
// ---------------------------------------------------------------------------

type OpenBaoAuth =
  | { method: "token"; token: () => string }
  | {
      method: "approle";
      mount: string;
      roleId: string;
      secretId: () => string;
    }
  | { method: "kubernetes"; mount: string; role: string; jwtPath: string };

export type OpenBaoConfig = {
  address: string;
  namespace?: string;
  transitMount: string;
  transitKey: string;
  auth: OpenBaoAuth;
  timeoutMs: number;
};

type TransitResponse = {
  data?: { ciphertext?: string; plaintext?: string };
  auth?: { client_token?: string; lease_duration?: number };
  errors?: string[];
};

export class OpenBaoTransitProvider implements KeyEncryptionProvider {
  readonly name = "openbao" as const;
  readonly source = "openbao" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: OpenBaoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  currentKekId(): string {
    return `openbao:${this.config.transitMount}/${this.config.transitKey}`;
  }

  async wrap(dataKey: Buffer, dataKeyId: string): Promise<WrappedDataKey> {
    // The data key id is sealed with the key so wrapped keys cannot be
    // swapped between rows.
    const plaintext = Buffer.concat([
      Buffer.from(`${dataKeyId}:`, "utf8"),
      dataKey,
    ]).toString("base64");
    const response = await this.call(
      `${this.config.transitMount}/encrypt/${this.config.transitKey}`,
      { plaintext },
    );
    const ciphertext = response.data?.ciphertext;
    if (!ciphertext) {
      throw new KeyUnavailableError(
        "OpenBao Transit returned no ciphertext when wrapping a data key.",
      );
    }
    return {
      wrapped: ciphertext,
      kekProvider: "openbao",
      kekId: this.currentKekId(),
    };
  }

  async unwrap(
    wrapped: string,
    kekId: string,
    dataKeyId: string,
  ): Promise<Buffer> {
    if (kekId !== this.currentKekId()) {
      throw new KeyUnavailableError(
        `data key ${dataKeyId} is wrapped by ${kekId}, but OpenBao is configured with ${this.currentKekId()}.`,
      );
    }
    const response = await this.call(
      `${this.config.transitMount}/decrypt/${this.config.transitKey}`,
      { ciphertext: wrapped },
    );
    const plaintext = response.data?.plaintext;
    if (!plaintext) {
      throw new KeyUnavailableError(
        `OpenBao Transit could not unwrap data key ${dataKeyId}.`,
      );
    }
    const decoded = Buffer.from(plaintext, "base64");
    const prefix = Buffer.from(`${dataKeyId}:`, "utf8");
    if (!decoded.subarray(0, prefix.length).equals(prefix)) {
      throw new KeyUnavailableError(
        `OpenBao returned a key that does not belong to data key ${dataKeyId}.`,
      );
    }
    const key = decoded.subarray(prefix.length);
    if (key.length !== KEY_BYTES) {
      throw new KeyUnavailableError(
        `OpenBao returned a data key of unexpected length for ${dataKeyId}.`,
      );
    }
    return key;
  }

  /**
   * Re-encrypts a wrapped key with the latest version of the Transit key, so
   * old key versions can be retired (min_decryption_version) in OpenBao.
   */
  async rewrap(wrapped: string): Promise<string> {
    const response = await this.call(
      `${this.config.transitMount}/rewrap/${this.config.transitKey}`,
      { ciphertext: wrapped },
    );
    return response.data?.ciphertext ?? wrapped;
  }

  describe(): Record<string, string> {
    let host = this.config.address;
    try {
      host = new URL(this.config.address).host;
    } catch {
      // keep the raw value
    }
    return {
      address: host,
      ...(this.config.namespace ? { namespace: this.config.namespace } : {}),
      transitKey: `${this.config.transitMount}/${this.config.transitKey}`,
      auth: this.config.auth.method,
    };
  }

  private async call(
    path: string,
    body: Record<string, unknown>,
    retryOnAuthError = true,
  ): Promise<TransitResponse> {
    const token = await this.getToken();
    const response = await this.request(path, body, token);
    if (response.status >= 500 || response.status === 429) {
      throw new TransientKeyError(
        `OpenBao is unavailable (${response.status} on ${path}).`,
      );
    }
    if (
      (response.status === 401 || response.status === 403) &&
      retryOnAuthError &&
      this.config.auth.method !== "token"
    ) {
      // Expired login token: log in again once.
      this.token = null;
      return this.call(path, body, false);
    }
    const json = (await response.json().catch(() => ({}))) as TransitResponse;
    if (!response.ok) {
      const detail = json.errors?.join("; ") || response.statusText;
      throw new KeyUnavailableError(
        `OpenBao request to ${path} failed (${response.status}): ${detail}`,
      );
    }
    return json;
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    token?: string,
  ): Promise<Response> {
    const url = new URL(`/v1/${path.replace(/^\/+/, "")}`, this.config.address);
    return this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Vault-Token": token } : {}),
        ...(this.config.namespace
          ? { "X-Vault-Namespace": this.config.namespace }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    }).catch((error: unknown) => {
      throw new TransientKeyError(
        `OpenBao at ${url.host} is unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async getToken(): Promise<string> {
    const auth = this.config.auth;
    if (auth.method === "token") return auth.token();
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }

    const loginBody =
      auth.method === "approle"
        ? { role_id: auth.roleId, secret_id: auth.secretId() }
        : { role: auth.role, jwt: readFileSync(auth.jwtPath, "utf8").trim() };
    const response = await this.request(`auth/${auth.mount}/login`, loginBody);
    if (response.status >= 500 || response.status === 429) {
      throw new TransientKeyError(
        `OpenBao is unavailable (${response.status} on ${auth.method} login).`,
      );
    }
    const json = (await response.json().catch(() => ({}))) as TransitResponse;
    const clientToken = json.auth?.client_token;
    if (!response.ok || !clientToken) {
      const detail = json.errors?.join("; ") || response.statusText;
      throw new KeyUnavailableError(
        `OpenBao ${auth.method} login failed (${response.status}): ${detail}`,
      );
    }
    // Renew a bit before the lease ends; tokens are only used briefly.
    const leaseSeconds = json.auth?.lease_duration ?? 300;
    this.token = {
      value: clientToken,
      expiresAt: Date.now() + Math.max(leaseSeconds - 30, 10) * 1000,
    };
    return clientToken;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function readSecretEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): (() => string) | undefined {
  const direct = env[name]?.trim();
  if (direct) return () => direct;
  const file = env[`${name}_FILE`]?.trim();
  if (file) return () => readFileSync(file, "utf8").trim();
  return undefined;
}

export type ProviderSetup = {
  /** Wraps new data keys. */
  primary: KeyEncryptionProvider;
  /**
   * Other configured providers, only used to unwrap data keys wrapped before
   * switching provider (local -> OpenBao or back). Such keys are re-wrapped
   * with the primary provider at startup.
   */
  fallbacks: KeyEncryptionProvider[];
  warnings: string[];
  /** BETTER_AUTH_SECRET is the public example value (and protects secrets). */
  usesExampleAuthSecret: boolean;
};

function createOpenBaoProvider(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): OpenBaoTransitProvider | null {
  const address = (env.OPENBAO_ADDR ?? env.VAULT_ADDR)?.trim();
  if (!address) return null;

  const token =
    readSecretEnv(env, "OPENBAO_TOKEN") ?? readSecretEnv(env, "VAULT_TOKEN");
  const roleId = env.OPENBAO_ROLE_ID?.trim();
  const secretId = readSecretEnv(env, "OPENBAO_SECRET_ID");
  const k8sRole = env.OPENBAO_K8S_ROLE?.trim();

  let auth: OpenBaoAuth;
  if (roleId && secretId) {
    auth = {
      method: "approle",
      mount: env.OPENBAO_APPROLE_MOUNT?.trim() || "approle",
      roleId,
      secretId,
    };
  } else if (k8sRole) {
    auth = {
      method: "kubernetes",
      mount: env.OPENBAO_K8S_MOUNT?.trim() || "kubernetes",
      role: k8sRole,
      jwtPath:
        env.OPENBAO_K8S_TOKEN_PATH?.trim() ||
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
    };
  } else if (token) {
    auth = { method: "token", token };
  } else {
    throw new SecretsConfigError(
      "OpenBao needs credentials: OPENBAO_TOKEN (or OPENBAO_TOKEN_FILE), OPENBAO_ROLE_ID + OPENBAO_SECRET_ID, or OPENBAO_K8S_ROLE.",
    );
  }

  return new OpenBaoTransitProvider(
    {
      address,
      namespace: env.OPENBAO_NAMESPACE?.trim() || undefined,
      transitMount: env.OPENBAO_TRANSIT_MOUNT?.trim() || "transit",
      transitKey: env.OPENBAO_TRANSIT_KEY?.trim() || "metamcp",
      auth,
      timeoutMs: Number(env.OPENBAO_TIMEOUT_MS) || 10_000,
    },
    fetchImpl,
  );
}

export function createProviders(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): ProviderSetup {
  const warnings: string[] = [];
  // SECRETS_ENCRYPTION_KEY_FILE: a mounted secret (Docker / Kubernetes), so
  // the key does not have to sit in an environment file.
  const keyFile = env.SECRETS_ENCRYPTION_KEY_FILE?.trim();
  const dedicatedValue = keyFile
    ? readFileSync(keyFile, "utf8").trim()
    : env.SECRETS_ENCRYPTION_KEY?.trim();
  const dedicated = dedicatedValue
    ? parseKeyMaterial(
        dedicatedValue,
        keyFile ? "SECRETS_ENCRYPTION_KEY_FILE" : "SECRETS_ENCRYPTION_KEY",
      )
    : undefined;
  const previous = (env.SECRETS_ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseKeyMaterial(value, "SECRETS_ENCRYPTION_KEY_PREVIOUS"));
  const authSecret = env.BETTER_AUTH_SECRET?.trim();
  const derived = authSecret ? deriveKeyFromAuthSecret(authSecret) : undefined;
  const local = LocalKekProvider.fromKeys({ dedicated, previous, derived });
  const providerName = (env.SECRETS_PROVIDER ?? "local").trim().toLowerCase();
  const openbaoRequired =
    providerName === "openbao" || providerName === "vault";

  // With the local provider OpenBao is only a fallback (data keys wrapped by
  // it earlier): an unrelated VAULT_ADDR in the environment must not stop the
  // startup when no OpenBao credentials are configured.
  let openbao: OpenBaoTransitProvider | null = null;
  try {
    openbao = createOpenBaoProvider(env, fetchImpl);
  } catch (error) {
    if (openbaoRequired || !(error instanceof SecretsConfigError)) throw error;
    warnings.push(
      `OPENBAO_ADDR / VAULT_ADDR is set without OpenBao credentials; it is ignored because SECRETS_PROVIDER is "${providerName}".`,
    );
  }

  if (openbaoRequired) {
    if (!openbao) {
      throw new SecretsConfigError(
        "SECRETS_PROVIDER=openbao requires OPENBAO_ADDR (for example https://openbao.example.com:8200).",
      );
    }
    return {
      primary: openbao,
      fallbacks: local ? [local] : [],
      warnings,
      usesExampleAuthSecret: false,
    };
  }

  if (providerName !== "local") {
    throw new SecretsConfigError(
      `Unknown SECRETS_PROVIDER "${providerName}" (expected "local" or "openbao").`,
    );
  }
  if (!local) {
    throw new SecretsConfigError(
      "No key is available to encrypt secrets: set SECRETS_ENCRYPTION_KEY (openssl rand -base64 32) or configure OpenBao (SECRETS_PROVIDER=openbao).",
    );
  }
  const usesExampleAuthSecret =
    local.source === "derived" && isPlaceholderSecret(authSecret);
  if (local.source === "derived") {
    warnings.push(
      usesExampleAuthSecret
        ? "Secrets are encrypted with a key derived from the example BETTER_AUTH_SECRET, which is public: set BETTER_AUTH_SECRET and SECRETS_ENCRYPTION_KEY to random values."
        : "Secrets are encrypted with a key derived from BETTER_AUTH_SECRET. Set a dedicated SECRETS_ENCRYPTION_KEY (or use OpenBao) so that both secrets can be rotated independently.",
    );
  }
  return {
    primary: local,
    fallbacks: openbao ? [openbao] : [],
    warnings,
    usesExampleAuthSecret,
  };
}
