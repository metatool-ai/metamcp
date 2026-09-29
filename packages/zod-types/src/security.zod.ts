import { z } from "zod";

// Encryption of secrets at rest (MCP server credentials, upstream OAuth
// tokens): status shown to administrators and data key rotation.

export const EncryptionProviderEnum = z.enum(["local", "openbao"]);
export type EncryptionProvider = z.infer<typeof EncryptionProviderEnum>;

/** Where the key encryption key comes from. */
export const EncryptionKeySourceEnum = z.enum([
  "dedicated", // SECRETS_ENCRYPTION_KEY
  "derived", // derived from BETTER_AUTH_SECRET (fallback)
  "openbao", // OpenBao / Vault Transit
]);
export type EncryptionKeySource = z.infer<typeof EncryptionKeySourceEnum>;

export const EncryptionKeyStateEnum = z.enum(["active", "pending", "retired"]);
export type EncryptionKeyState = z.infer<typeof EncryptionKeyStateEnum>;

export const EncryptionStatusSchema = z.object({
  provider: EncryptionProviderEnum,
  source: EncryptionKeySourceEnum,
  /** Non-secret provider details (OpenBao address, Transit key, ...). */
  details: z.record(z.string(), z.string()),
  usesExampleAuthSecret: z.boolean(),
  activationDelaySeconds: z.number(),
  keys: z.array(
    z.object({
      id: z.string(),
      kekProvider: z.string(),
      createdAt: z.date(),
      activatedAt: z.date(),
      state: EncryptionKeyStateEnum,
      /** Stored values encrypted with this key. */
      values: z.number(),
    }),
  ),
  /** Values still stored in clear text (encrypted at the next startup). */
  plaintextValues: z.number(),
});
export type EncryptionStatus = z.infer<typeof EncryptionStatusSchema>;

export const RotateDataKeyResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  keyId: z.string().optional(),
  activatesAt: z.date().optional(),
});
export type RotateDataKeyResponse = z.infer<typeof RotateDataKeyResponseSchema>;
