import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config.service", () => ({
  configService: { getSessionLifetime: vi.fn(async () => null) },
}));

import {
  nonNegativeIntFromEnv,
  SessionLifetimeManagerImpl,
} from "./session-lifetime-manager";

function fakeResponse() {
  const emitter = new EventEmitter();
  return {
    res: { once: (event: "close", fn: () => void) => emitter.once(event, fn) },
    close: () => emitter.emit("close"),
  };
}

describe("SessionLifetimeManagerImpl idle timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires idle sessions but never one with an open request", async () => {
    vi.useFakeTimers();
    const manager = new SessionLifetimeManagerImpl<string>("test", {
      idleTimeoutMs: 1000,
    });
    manager.addSession("idle", "a");
    manager.addSession("streaming", "b");
    const stream = fakeResponse();
    manager.trackRequest("streaming", stream.res);

    vi.advanceTimersByTime(1500);
    const cleaned: string[] = [];
    await manager.cleanupExpiredSessions(async (id) => {
      cleaned.push(id);
      manager.removeSession(id);
    });
    expect(cleaned).toEqual(["idle"]);

    // Once the stream closes, the session becomes idle from that moment.
    stream.close();
    vi.advanceTimersByTime(500);
    await manager.cleanupExpiredSessions(async (id) => {
      cleaned.push(id);
    });
    expect(cleaned).toEqual(["idle"]);
    vi.advanceTimersByTime(600);
    await manager.cleanupExpiredSessions(async (id) => {
      cleaned.push(id);
    });
    expect(cleaned).toEqual(["idle", "streaming"]);
  });

  it("keeps sessions forever without lifetime nor idle timeout", async () => {
    vi.useFakeTimers();
    const manager = new SessionLifetimeManagerImpl<string>("test");
    manager.addSession("s", "a");
    vi.advanceTimersByTime(10 * 24 * 3600 * 1000);
    const cleanup = vi.fn(async () => {});
    await manager.cleanupExpiredSessions(cleanup);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("picks the least recently used session without a request in flight", () => {
    vi.useFakeTimers();
    const manager = new SessionLifetimeManagerImpl<string>("test", {
      idleTimeoutMs: 1000,
    });
    manager.addSession("old", "a");
    vi.advanceTimersByTime(10);
    manager.addSession("middle", "b");
    vi.advanceTimersByTime(10);
    manager.addSession("recent", "c");
    manager.trackRequest("old", fakeResponse().res);
    expect(manager.leastRecentlyUsed(["old", "middle", "recent"])).toBe(
      "middle",
    );
    expect(manager.leastRecentlyUsed(["old"])).toBeUndefined();
  });
});

describe("nonNegativeIntFromEnv", () => {
  it("falls back on missing or invalid values", () => {
    expect(nonNegativeIntFromEnv(undefined, 5)).toBe(5);
    expect(nonNegativeIntFromEnv("", 5)).toBe(5);
    expect(nonNegativeIntFromEnv("-1", 5)).toBe(5);
    expect(nonNegativeIntFromEnv("abc", 5)).toBe(5);
    expect(nonNegativeIntFromEnv("0", 5)).toBe(0);
    expect(nonNegativeIntFromEnv("1500", 5)).toBe(1500);
  });
});
