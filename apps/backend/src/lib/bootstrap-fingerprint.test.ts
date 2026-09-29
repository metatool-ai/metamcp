import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  fingerprintMatches,
  isComparableFingerprint,
  passwordFingerprint,
} from "./bootstrap-fingerprint";

describe("bootstrap password fingerprint", () => {
  it("is a salted scrypt hash that matches only its password", () => {
    const first = passwordFingerprint("correct horse battery staple");
    const second = passwordFingerprint("correct horse battery staple");

    expect(first).toMatch(/^scrypt:[\w-]+:[\w-]+$/);
    // Salted: the same password never gives the same fingerprint
    expect(first).not.toBe(second);
    expect(fingerprintMatches(first, "correct horse battery staple")).toBe(
      true,
    );
    expect(fingerprintMatches(first, "correct horse battery stapler")).toBe(
      false,
    );
  });

  it("treats the formats of earlier versions as unknown", () => {
    const sha256 = crypto.createHash("sha256").update("secret").digest("hex");
    for (const legacy of [sha256, `hmac-sha256:${sha256}`]) {
      expect(isComparableFingerprint(legacy)).toBe(false);
      expect(fingerprintMatches(legacy, "secret")).toBe(false);
    }
  });

  it("rejects malformed fingerprints", () => {
    expect(fingerprintMatches("scrypt:", "secret")).toBe(false);
    expect(fingerprintMatches("scrypt:c2FsdA", "secret")).toBe(false);
  });
});
