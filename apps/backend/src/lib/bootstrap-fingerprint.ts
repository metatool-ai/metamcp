import crypto from "node:crypto";

const FINGERPRINT_PREFIX = "scrypt:";

/**
 * Fingerprint of the last applied bootstrap password, to notice when the
 * environment value changes. It is derived from an admin password and kept
 * in the database: a salted scrypt hash, like a password hash.
 */
export function passwordFingerprint(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `${FINGERPRINT_PREFIX}${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

/**
 * Whether `stored` can be compared with a password. Fingerprints written by
 * earlier versions (SHA-256, HMAC) cannot: they count as unknown.
 */
export function isComparableFingerprint(stored: string): boolean {
  return stored.startsWith(FINGERPRINT_PREFIX);
}

export function fingerprintMatches(stored: string, password: string): boolean {
  if (!isComparableFingerprint(stored)) return false;
  const [salt, hash] = stored.slice(FINGERPRINT_PREFIX.length).split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = crypto.scryptSync(
    password,
    Buffer.from(salt, "base64url"),
    expected.length,
  );
  return (
    expected.length > 0 &&
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}
