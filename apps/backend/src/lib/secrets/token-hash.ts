import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer credentials issued by MetaMCP (API keys, OAuth access / refresh
 * tokens, authorization codes, client secrets) are only needed to be
 * recognised, never read back: MetaMCP stores their SHA-256 digest.
 *
 * They are long random strings (API keys carry ~380 bits of entropy), so a
 * fast hash is the right tool: slow password hashes (bcrypt, argon2) protect
 * low-entropy passwords and would only slow down every request.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time check of a presented credential against a stored digest. */
export function matchesTokenHash(
  presented: string | undefined | null,
  storedHash: string | undefined | null,
): boolean {
  if (!presented || !storedHash) return false;
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashToken(presented), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Recognisable, non-secret rendering of an API key: `sk_mt_AbCd…wxyz`. */
export function previewApiKey(key: string): string {
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}
