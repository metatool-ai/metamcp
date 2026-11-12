import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateRedirectUri } from "./utils";

describe("validateRedirectUri", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("in production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    // RFC 8252 section 7.3 / OAuth 2.1: native clients listen on a loopback
    // port chosen at runtime and redirect there over plain http. The MCP spec
    // builds on this, so rejecting these makes OAuth unusable for MCP clients.
    it.each([
      "http://localhost:3118/callback",
      "http://127.0.0.1:51000/callback",
      "http://[::1]:51000/callback",
    ])("accepts the loopback redirect %s", (uri) => {
      expect(validateRedirectUri(uri)).toBe(true);
    });

    it("accepts an https redirect on a public host", () => {
      expect(validateRedirectUri("https://example.com/callback")).toBe(true);
    });

    it("rejects plain http on a non-loopback host", () => {
      expect(validateRedirectUri("http://example.com/callback")).toBe(false);
    });

    it.each([
      "http://192.168.1.50/callback",
      "http://10.0.0.5/callback",
      "http://172.16.0.5/callback",
      "https://192.168.1.50/callback",
    ])("rejects the private-network address %s", (uri) => {
      expect(validateRedirectUri(uri)).toBe(false);
    });

    it("does not treat a host that merely starts with localhost as loopback", () => {
      expect(validateRedirectUri("http://localhost.example.com/cb")).toBe(
        false,
      );
    });

    it.each(["ftp://localhost/callback", "javascript:alert(1)", "not a url"])(
      "rejects %s",
      (uri) => {
        expect(validateRedirectUri(uri)).toBe(false);
      },
    );

    it("still honours an explicit allowed-hosts list", () => {
      expect(
        validateRedirectUri("https://example.com/cb", ["other.example.com"]),
      ).toBe(false);
      expect(
        validateRedirectUri("https://example.com/cb", ["example.com"]),
      ).toBe(true);
    });
  });

  describe("outside production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("allows plain http on any host", () => {
      expect(validateRedirectUri("http://example.com/callback")).toBe(true);
      expect(validateRedirectUri("http://localhost:3000/callback")).toBe(true);
    });

    it("still rejects non-http(s) schemes", () => {
      expect(validateRedirectUri("ftp://example.com/callback")).toBe(false);
    });
  });
});
