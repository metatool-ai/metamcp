import { ServerParameters } from "@repo/zod-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedClient } from "./client";

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../config.service", () => ({
  configService: { getSessionLifetime: vi.fn(async () => null) },
}));
vi.mock("./log-store", () => ({ metamcpLogStore: { addLog: vi.fn() } }));
vi.mock("./server-error-tracker", () => ({
  serverErrorTracker: {
    recordServerCrash: vi.fn(async () => undefined),
    isServerInErrorState: vi.fn(async () => false),
    resetServerErrorState: vi.fn(async () => undefined),
  },
}));

type FakeClient = ConnectedClient & {
  closed: boolean;
  ping: ReturnType<typeof vi.fn>;
};

const { connected } = vi.hoisted(() => ({ connected: [] as FakeClient[] }));

vi.mock("./client", () => ({
  connectMetaMcpClient: vi.fn(async () => {
    const ping = vi.fn(async () => ({}));
    const fake: FakeClient = {
      closed: false,
      ping,
      client: { ping } as unknown as ConnectedClient["client"],
      cleanup: vi.fn(async () => {
        fake.closed = true;
      }),
    };
    connected.push(fake);
    return fake;
  }),
}));

import {
  McpServerPool,
  McpServerPoolOptions,
  poolOptionsFromEnv,
} from "./mcp-server-pool";

const TTL = 60_000;

const params = (
  uuid: string,
  extra: Partial<ServerParameters> = {},
): ServerParameters =>
  ({
    uuid,
    name: uuid,
    type: "STDIO",
    command: "server",
    args: [],
    ...extra,
  }) as ServerParameters;

const pools: McpServerPool[] = [];

function makePool(options: Partial<McpServerPoolOptions> = {}): McpServerPool {
  const pool = new McpServerPool({
    warmPool: false,
    connectionIdleTtlMs: TTL,
    maxTotalConnections: 100,
    maxConnectionsPerServer: 5,
    ...options,
  });
  pools.push(pool);
  return pool;
}

/** Lets fire-and-forget promise chains (background idle creation) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function later(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));
  connected.length = 0;
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.cleanupAll()));
  vi.useRealTimers();
});

describe("McpServerPool on demand (default)", () => {
  it("opens connections on first use and starts no spare", async () => {
    const pool = makePool();

    const first = await pool.getSession("s1", "a", params("a"));
    await flush();
    expect(connected).toHaveLength(1);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 0, active: 1 });

    // The ended session's connection is parked for the next client
    await pool.cleanupSession("s1");
    expect(first?.cleanup).not.toHaveBeenCalled();
    expect(pool.getPoolStatus()).toMatchObject({ idle: 1, active: 0 });

    const second = await pool.getSession("s2", "a", params("a"));
    await flush();
    expect(second).toBe(first);
    expect(connected).toHaveLength(1);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 0, active: 1 });
  });

  it("closes a parked connection nobody took within the TTL", async () => {
    const pool = makePool();
    await pool.getSession("s1", "a", params("a"));
    await pool.cleanupSession("s1");

    later(TTL - 1000);
    await pool.reapIdleConnections();
    expect(connected[0].closed).toBe(false);

    later(2000);
    await pool.reapIdleConnections();
    expect(connected[0].closed).toBe(true);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 0, active: 0 });
  });

  it("releases the connections a session stopped using and gives them back on its next request", async () => {
    const pool = makePool();
    const a = await pool.getSession("s1", "a", params("a"));
    const b = await pool.getSession("s1", "b", params("b"));

    later(TTL / 2);
    expect(pool.getActiveConnection("s1", "a")).toBe(a);
    later(TTL / 2 + 1000);
    await pool.reapIdleConnections();

    // b was unused for longer than the TTL: parked, not closed (no spare yet)
    expect(pool.getActiveConnection("s1", "b")).toBeUndefined();
    expect(pool.getActiveConnection("s1", "a")).toBe(a);
    expect(b?.cleanup).not.toHaveBeenCalled();
    expect(pool.getPoolStatus().idleServerUuids).toEqual(["b"]);

    // The session gets it back without a new connection
    expect(await pool.getSession("s1", "b", params("b"))).toBe(b);
    expect(connected).toHaveLength(2);
  });

  it("never releases a connection while a request of its session is in flight", async () => {
    const pool = makePool();
    const a = await pool.getSession("s1", "a", params("a"));

    const call = deferred();
    const request = pool.trackRequest("s1", async () => {
      pool.getActiveConnection("s1", "a");
      await call.promise;
    });

    later(3 * TTL);
    await pool.reapIdleConnections();
    expect(pool.getActiveConnection("s1", "a")).toBe(a);

    // A connection used by a request counts as used until it ends
    later(3 * TTL);
    call.resolve();
    await request;
    later(TTL - 1000);
    await pool.reapIdleConnections();
    expect(pool.getActiveConnection("s1", "a")).toBe(a);
  });

  it("keeps connections until their session ends when the TTL is 0", async () => {
    const pool = makePool({ connectionIdleTtlMs: 0 });
    const a = await pool.getSession("s1", "a", params("a"));
    await pool.getSession("s2", "b", params("b"));
    await pool.cleanupSession("s2");

    later(24 * 60 * 60 * 1000);
    await pool.reapIdleConnections();
    expect(pool.getActiveConnection("s1", "a")).toBe(a);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 1, active: 1 });
  });

  it("closes a dead parked connection without starting another one", async () => {
    const pool = makePool({ connectionIdleTtlMs: 10 * TTL });
    await pool.getSession("s1", "a", params("a"));
    await pool.cleanupSession("s1");
    connected[0].ping.mockRejectedValue(new Error("Not connected"));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(connected[0].closed).toBe(true);
    expect(connected).toHaveLength(1);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 0, active: 0 });
  });

  it("does not open connections when a server is created or changed", async () => {
    const pool = makePool();
    await pool.ensureIdleSessionForNewServer("a", params("a"));
    expect(connected).toHaveLength(0);

    await pool.getSession("s1", "b", params("b"));
    await pool.cleanupSession("s1");
    await pool.invalidateIdleSession("b", params("b", { command: "new" }));
    expect(connected[0].closed).toBe(true);
    expect(connected).toHaveLength(1);
  });

  it("never parks a connection opened with a client's forwarded headers", async () => {
    const pool = makePool();
    const withHeaders = params("fh", {
      forward_headers: { "x-user-token": "Authorization" },
    });

    const client = await pool.getSession("s1", "fh", withHeaders);
    await pool.cleanupSession("s1");

    expect(client?.cleanup).toHaveBeenCalled();
    expect(pool.getPoolStatus()).toMatchObject({ idle: 0, active: 0 });
  });
});

describe("McpServerPool per-server cap", () => {
  it("takes over the connection of the least recently active session instead of sharing it", async () => {
    const pool = makePool({ maxConnectionsPerServer: 2 });
    const first = await pool.getSession("s1", "a", params("a"));
    later(1000);
    await pool.getSession("s2", "a", params("a"));
    later(1000);

    const third = await pool.getSession("s3", "a", params("a"));

    expect(third).toBe(first);
    expect(connected).toHaveLength(2);
    expect(pool.getActiveConnection("s1", "a")).toBeUndefined();

    // s1 opens one again on its next request (taking over s2's)
    later(1000);
    expect(await pool.getSession("s1", "a", params("a"))).toBe(connected[1]);
  });

  it("shares a connection only while every holder is busy, and never closes it under another session", async () => {
    const pool = makePool({ maxConnectionsPerServer: 2 });
    const first = await pool.getSession("s1", "a", params("a"));
    later(1000);
    await pool.getSession("s2", "a", params("a"));

    const busy = deferred();
    const requests = [
      pool.trackRequest("s1", () => busy.promise),
      pool.trackRequest("s2", () => busy.promise),
    ];

    const shared = await pool.getSession("s3", "a", params("a"));
    expect(shared).toBe(first);
    expect(connected).toHaveLength(2);

    // s3 ends while s1 still uses the shared connection
    await pool.cleanupSession("s3");
    expect(first?.cleanup).not.toHaveBeenCalled();
    expect(pool.getPoolStatus().idle).toBe(0);
    expect(pool.getActiveConnection("s1", "a")).toBe(first);

    busy.resolve();
    await Promise.all(requests);
  });
});

describe("McpServerPool warm pool", () => {
  it("keeps a spare ready, replaced as soon as a client takes it", async () => {
    const pool = makePool({ warmPool: true });
    await pool.ensureIdleSessions({ a: params("a") });
    expect(connected).toHaveLength(1);

    const taken = await pool.getSession("s1", "a", params("a"));
    await flush();
    expect(taken).toBe(connected[0]);
    expect(connected).toHaveLength(2);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 1, active: 1 });

    // Unused connections of sessions are still released; the spare stays
    later(2 * TTL);
    await pool.reapIdleConnections();
    expect(connected[0].closed).toBe(true);
    expect(connected[1].closed).toBe(false);
    expect(pool.getPoolStatus()).toMatchObject({ idle: 1, active: 0 });
  });
});

describe("poolOptionsFromEnv", () => {
  it("defaults to connections on demand, closed after 15 minutes unused", () => {
    expect(poolOptionsFromEnv({})).toEqual({
      warmPool: false,
      connectionIdleTtlMs: 15 * 60 * 1000,
      maxTotalConnections: 100,
      maxConnectionsPerServer: 5,
    });
  });

  it("reads overrides and ignores invalid values", () => {
    expect(
      poolOptionsFromEnv({
        MCP_WARM_POOL: "true",
        MCP_CONNECTION_IDLE_TTL: "0",
        MAX_CONNECTIONS_PER_SERVER: "2",
        MAX_TOTAL_CONNECTIONS: "many",
      }),
    ).toEqual({
      warmPool: true,
      connectionIdleTtlMs: 0,
      maxTotalConnections: 100,
      maxConnectionsPerServer: 2,
    });
  });
});
