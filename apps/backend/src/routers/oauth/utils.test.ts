import { afterEach, describe, expect, it, vi } from "vitest";

import { validateRedirectUri } from "./utils";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateRedirectUri", () => {
  it.each([
    "http://LOCALHOST:49152/callback",
    "http://127.0.0.1:49153/callback",
    "http://[::1]:49154/callback",
    "http://[0:0:0:0:0:0:0:1]:49155/callback",
  ])(
    "accepts an HTTP native loopback redirect URI in production: %s",
    (uri) => {
      vi.stubEnv("NODE_ENV", "production");

      expect(validateRedirectUri(uri)).toBe(true);
    },
  );

  it.each([
    "http://example.com:49152/callback",
    "http://192.168.1.10:49152/callback",
    "http://10.0.0.10:49152/callback",
    "http://172.16.0.10:49152/callback",
    "http://169.254.169.254:49152/callback",
    "http://[fd00::1]:49152/callback",
    "http://localhost.:49152/callback",
  ])("rejects a non-loopback HTTP redirect URI in production: %s", (uri) => {
    vi.stubEnv("NODE_ENV", "production");

    expect(validateRedirectUri(uri)).toBe(false);
  });

  it.each([
    "https://localhost/callback",
    "https://127.0.0.1/callback",
    "https://[::1]/callback",
  ])("rejects an HTTPS loopback redirect URI in production: %s", (uri) => {
    vi.stubEnv("NODE_ENV", "production");

    expect(validateRedirectUri(uri)).toBe(false);
  });

  it("accepts a public HTTPS redirect URI in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(validateRedirectUri("https://example.com/callback")).toBe(true);
  });

  it("applies allowedHosts to HTTP loopback redirect URIs in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      validateRedirectUri("http://localhost:49152/callback", ["localhost"]),
    ).toBe(true);
    expect(
      validateRedirectUri("http://localhost:49152/callback", ["example.com"]),
    ).toBe(false);
  });

  it("preserves non-production support for HTTP redirect URIs", () => {
    vi.stubEnv("NODE_ENV", "test");

    expect(validateRedirectUri("http://192.168.1.10:49152/callback")).toBe(
      true,
    );
  });
});
