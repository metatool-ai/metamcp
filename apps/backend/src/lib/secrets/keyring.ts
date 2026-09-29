import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption of secrets at rest (envelope encryption).
 *
 * Secret values (MCP server environment values, headers, bearer tokens, URLs,
 * arguments, upstream OAuth tokens, ...) are encrypted with AES-256-GCM using
 * a data encryption key (DEK). DEKs live in the `encryption_keys` table,
 * wrapped by a key encryption key (KEK) that never touches the database: a
 * local key (SECRETS_ENCRYPTION_KEY) or an OpenBao / Vault Transit key.
 *
 * This module only holds the unwrapped DEKs in memory. It is synchronous so it
 * can back Drizzle column types; loading, wrapping and rotating keys lives in
 * secrets.service.ts.
 *
 * Stored format: `enc:v1:<data key id>:<base64url(iv | ciphertext | tag)>`.
 * Values without the prefix are legacy plaintext: they are read as-is and
 * encrypted by the startup sweep.
 */

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const DATA_KEY_BYTES = 32;

type Keyring = {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
};

let keyring: Keyring | null = null;

export class SecretsNotReadyError extends Error {
  constructor() {
    super(
      "Secrets encryption is not initialized: encryption keys must be loaded before reading or writing secrets.",
    );
    this.name = "SecretsNotReadyError";
  }
}

export class SecretDecryptionError extends Error {
  constructor(context: string, reason: string) {
    super(`Cannot decrypt ${context}: ${reason}`);
    this.name = "SecretDecryptionError";
  }
}

export function installKeyring(next: Keyring): void {
  if (!next.keys.has(next.activeKeyId)) {
    throw new Error(`Active data key ${next.activeKeyId} is not loaded`);
  }
  keyring = next;
}

/** Test helper: forget every loaded key. */
export function clearKeyring(): void {
  keyring = null;
}

export function isKeyringReady(): boolean {
  return keyring !== null;
}

export function getActiveKeyId(): string | null {
  return keyring?.activeKeyId ?? null;
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Data key a stored value is encrypted with, or null for plaintext. */
export function encryptedWithKeyId(value: unknown): string | null {
  if (!isEncryptedSecret(value)) return null;
  const rest = value.slice(PREFIX.length);
  const separator = rest.indexOf(":");
  return separator > 0 ? rest.slice(0, separator) : null;
}

function additionalData(keyId: string, context: string): Buffer {
  // Binds a ciphertext to its data key and to the column (and map key) it was
  // written to, so values cannot be swapped between fields unnoticed.
  return Buffer.from(`metamcp:${keyId}:${context}`, "utf8");
}

/**
 * Encrypts a secret with the active data key. Empty strings are kept as-is:
 * there is nothing to protect and it keeps "is this set?" checks simple.
 */
export function encryptSecret(plaintext: string, context: string): string {
  if (plaintext === "") return plaintext;
  const current = keyring;
  const key = current?.keys.get(current.activeKeyId);
  if (!current || !key) {
    throw new SecretsNotReadyError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(additionalData(current.activeKeyId, context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  return `${PREFIX}${current.activeKeyId}:${payload.toString("base64url")}`;
}

/** Decrypts a stored value; legacy plaintext values are returned unchanged. */
export function decryptSecret(value: string, context: string): string {
  if (!isEncryptedSecret(value)) return value;
  if (!keyring) {
    throw new SecretsNotReadyError();
  }

  const rest = value.slice(PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) {
    throw new SecretDecryptionError(context, "malformed value");
  }
  const keyId = rest.slice(0, separator);
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new SecretDecryptionError(context, `unknown data key "${keyId}"`);
  }

  const payload = Buffer.from(rest.slice(separator + 1), "base64url");
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new SecretDecryptionError(context, "truncated value");
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES, payload.length - TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additionalData(keyId, context));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptionError(context, "integrity check failed");
  }
}

/** Encrypts each value of a string map (keys stay readable). */
export function encryptSecretMap(
  values: Record<string, string>,
  context: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string"
        ? encryptSecret(value, `${context}:${name}`)
        : value,
    ]),
  );
}

export function decryptSecretMap(
  values: Record<string, unknown>,
  context: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string"
        ? decryptSecret(value, `${context}:${name}`)
        : (value as string),
    ]),
  );
}

/** Encrypts a whole JSON document into a single string. */
export function encryptSecretJson(value: unknown, context: string): string {
  return encryptSecret(JSON.stringify(value), context);
}

/**
 * Reads a JSON document stored either encrypted (a string) or as legacy
 * plaintext JSON (an object).
 */
export function decryptSecretJson<T>(stored: unknown, context: string): T {
  if (isEncryptedSecret(stored)) {
    return JSON.parse(decryptSecret(stored, context)) as T;
  }
  return stored as T;
}

export function generateDataKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES);
}
