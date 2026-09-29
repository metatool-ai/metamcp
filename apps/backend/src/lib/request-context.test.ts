import type { AddressInfo } from "node:net";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthRateLimiter } from "./auth-rate-limiter";
import {
  clientAddress,
  clientRateLimitKey,
  trustProxySetting,
} from "./request-context";

describe("trustProxySetting", () => {
  it("trusts the bundled proxy and private-network proxies by default", () => {
    expect(trustProxySetting(undefined)).toEqual(["loopback", "uniquelocal"]);
    expect(trustProxySetting("  ")).toEqual(["loopback", "uniquelocal"]);
  });

  it("parses booleans, hop counts and address lists", () => {
    expect(trustProxySetting("false")).toBe(false);
    expect(trustProxySetting("TRUE")).toBe(true);
    expect(trustProxySetting("2")).toBe(2);
    expect(trustProxySetting("loopback, 10.0.0.0/8,,")).toEqual([
      "loopback",
      "10.0.0.0/8",
    ]);
  });
});

describe("client address behind the proxy chain", () => {
  let baseUrl = "";
  let close: () => void = () => {};
  const seen: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", trustProxySetting(undefined));
    app.get("/", (req, res) => {
      seen.push({
        address: clientAddress(req),
        key: clientRateLimitKey(req, ""),
        custom: clientRateLimitKey(req, "X-Client-Id"),
      });
      res.end();
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });

  afterAll(() => close());

  async function probe(headers: Record<string, string>) {
    seen.length = 0;
    await fetch(baseUrl, { headers });
    const [result] = seen;
    if (!result) throw new Error("no request recorded");
    return result;
  }

  it("uses the entry appended by the trusted hop, not a forged one", async () => {
    const result = await probe({
      "X-Forwarded-For": "6.6.6.6, 203.0.113.7",
    });
    expect(result.address).toBe("203.0.113.7");
    expect(result.key).toBe("ip:203.0.113.7");
  });

  it("skips private-network proxies up to the real client", async () => {
    // client -> nginx (10.0.0.5, appends the client) -> Next.js (appends nginx)
    const result = await probe({
      "X-Forwarded-For": "203.0.113.7, 10.0.0.5",
    });
    expect(result.address).toBe("203.0.113.7");
  });

  it("never reports a forged value that is not an address", async () => {
    const result = await probe({
      "X-Forwarded-For": "<script>, 10.0.0.5",
    });
    expect(result.address).toBe("10.0.0.5");
  });

  it("falls back to the socket address without forwarding headers", async () => {
    const result = await probe({});
    expect(result.address).toBe("127.0.0.1");
    expect(result.custom).toBe("ip:127.0.0.1");
  });

  it("keys on an administrator-chosen header when configured", async () => {
    const result = await probe({ "X-Client-Id": "tenant-42" });
    expect(result.custom).toBe("header:tenant-42");
  });
});

describe("AuthRateLimiter", () => {
  it("only counts failures and blocks once the budget is spent", () => {
    const limiter = new AuthRateLimiter(3, 60_000);
    expect(limiter.isRateLimited("a")).toBe(false);
    limiter.recordFailedAttempt("a");
    limiter.recordFailedAttempt("a");
    // Checking is read-only: it must not consume attempts.
    expect(limiter.isRateLimited("a")).toBe(false);
    expect(limiter.isRateLimited("a")).toBe(false);
    limiter.recordFailedAttempt("a");
    expect(limiter.isRateLimited("a")).toBe(true);
    expect(limiter.isRateLimited("b")).toBe(false);
  });

  it("forgets failures once the window has passed", async () => {
    const limiter = new AuthRateLimiter(1, 5);
    limiter.recordFailedAttempt("a");
    expect(limiter.isRateLimited("a")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(limiter.isRateLimited("a")).toBe(false);
  });
});
