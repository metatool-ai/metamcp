import { customType } from "drizzle-orm/pg-core";

import {
  decryptSecret,
  decryptSecretJson,
  decryptSecretMap,
  encryptSecret,
  encryptSecretJson,
  encryptSecretMap,
} from "../lib/secrets/keyring";

/**
 * Column types that encrypt values on write and decrypt them on read, so every
 * query (including joins and `returning`) goes through encryption at rest.
 * The SQL types are unchanged (text, text[], jsonb): legacy plaintext rows
 * stay readable and are encrypted by the startup sweep.
 *
 * Never filter on these columns in SQL: each write uses a fresh IV.
 */

/** Text column holding a secret (URL, bearer token, PKCE verifier, ...). */
export const encryptedText = (name: string, context: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => encryptSecret(value, context),
    fromDriver: (value) => decryptSecret(value, context),
  })(name);

/**
 * jsonb string map whose values are secrets (environment variables, HTTP
 * headers). Names stay readable, values are encrypted one by one.
 */
export const encryptedStringMap = (name: string, context: string) =>
  customType<{ data: Record<string, string>; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(encryptSecretMap(value ?? {}, context)),
    fromDriver: (value) => {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return decryptSecretMap(
        (parsed ?? {}) as Record<string, unknown>,
        context,
      );
    },
  })(name);

/** jsonb document encrypted as a whole (stored as a JSON string). */
export const encryptedJson = <T>(name: string, context: string) =>
  customType<{ data: T; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(encryptSecretJson(value, context)),
    fromDriver: (value) => {
      // node-postgres parses jsonb; other drivers may hand over raw text.
      const parsed =
        typeof value === "string" && !value.startsWith("enc:")
          ? JSON.parse(value)
          : value;
      return decryptSecretJson<T>(parsed, context);
    },
  })(name);
