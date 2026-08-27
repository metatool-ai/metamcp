import { ServerParameters } from "@repo/zod-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pool's module graph transitively imports the DB (configService /
// serverErrorTracker), which throws at import time without DATABASE_URL. A
// dummy URL lets the pg Pool construct without connecting (no query is made
// by these tests).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://dummy:dummy@localhost:5432/dummy";
}

import { ConnectedClient } from "./client";
import { mcpServerPool } from "./mcp-server-pool";

// Access the pool's private internals for seeding state (tests only).
type PoolInternals = {
  activeSessions: Record<string, Record<string, ConnectedClient>>;
  sessionToServers: Record<string, Set<string>>;
  sessionTimestamps: Record<string, number>;
  idleSessions: Record<string, ConnectedClient>;
  createNewConnection: (
    params: ServerParameters,
    namespaceUuid?: string,
  ) => Promise<ConnectedClient | undefined>;
};
const poolInternals = mcpServerPool as unknown as PoolInternals;

// A pool-held client whose transport has been torn down — the exact state the
// SDK reaches after a backend container restart / process death. The SDK's
// Protocol clears `_transport` on close and then rejects every request with
// the bare "Not connected" envelope.
const makeDeadClient = (): ConnectedClient =>
  ({
    client: { transport: undefined },
    cleanup: vi.fn().mockResolvedValue(undefined),
    onProcessCrash: undefined,
  }) as unknown as ConnectedClient;

const makeLiveClient = (): ConnectedClient =>
  ({
    client: { transport: {} },
    cleanup: vi.fn().mockResolvedValue(undefined),
    onProcessCrash: undefined,
  }) as unknown as ConnectedClient;

const params = { uuid: "server-1", name: "test-server" } as ServerParameters;

describe("McpServerPool dead-connection recovery", () => {
  beforeEach(() => {
    // Reset the singleton's mutable state between tests (the timers are
    // unref'd, so leaking them is harmless, but the session maps must be
    // clean).
    void mcpServerPool.cleanupAll();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    void mcpServerPool.cleanupAll();
    vi.restoreAllMocks();
  });

  it("hands back a live client instead of a dead pooled one on getSession", async () => {
    const dead = makeDeadClient();
    const live = makeLiveClient();
    const sessionId = "session-abc";

    // Seed the pool with a DEAD active connection for the server.
    poolInternals.activeSessions[sessionId] = { "server-1": dead };
    poolInternals.sessionToServers[sessionId] = new Set(["server-1"]);
    poolInternals.sessionTimestamps[sessionId] = Date.now();

    // Stub the re-spawn so no real child process is started.
    const createSpy = vi
      .spyOn(poolInternals, "createNewConnection")
      .mockResolvedValue(live);

    const session = await mcpServerPool.getSession(
      sessionId,
      "server-1",
      params,
      "ns-1",
    );

    expect(session).toBe(live);
    expect(createSpy).toHaveBeenCalledWith(params, "ns-1");
    // The dead client was cleaned up (not leaked).
    expect(dead.cleanup).toHaveBeenCalled();
    // The live client is registered for the session.
    expect(poolInternals.activeSessions[sessionId]?.["server-1"]).toBe(live);
  });

  it("recovers a dead IDLE connection instead of handing it back", async () => {
    const dead = makeDeadClient();
    const live = makeLiveClient();
    const sessionId = "session-abc";

    poolInternals.idleSessions["server-1"] = dead;

    const createSpy = vi
      .spyOn(poolInternals, "createNewConnection")
      .mockResolvedValue(live);

    const session = await mcpServerPool.getSession(
      sessionId,
      "server-1",
      params,
      "ns-1",
    );

    expect(session).toBe(live);
    expect(createSpy).toHaveBeenCalledWith(params, "ns-1");
    expect(dead.cleanup).toHaveBeenCalled();
    // The dead idle slot was removed.
    expect(poolInternals.idleSessions["server-1"]).toBeUndefined();
    expect(poolInternals.activeSessions[sessionId]?.["server-1"]).toBe(live);
  });

  it("leaves a live idle connection untouched", async () => {
    const live = makeLiveClient();
    const sessionId = "session-abc";

    poolInternals.idleSessions["server-1"] = live;

    const createSpy = vi
      .spyOn(poolInternals, "createNewConnection")
      .mockResolvedValue(makeLiveClient());

    const session = await mcpServerPool.getSession(
      sessionId,
      "server-1",
      params,
      "ns-1",
    );

    // The live idle client was converted, not re-spawned.
    expect(session).toBe(live);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rebalances the per-namespace connection count when a dead connection is invalidated and re-spawned", async () => {
    const dead = makeDeadClient();
    const live = makeLiveClient();
    const sessionId = "session-abc";

    mcpServerPool["activeSessions"][sessionId] = { "server-1": dead };
    mcpServerPool["sessionToServers"][sessionId] = new Set(["server-1"]);
    mcpServerPool["sessionTimestamps"][sessionId] = Date.now();
    mcpServerPool["sessionNamespaces"].set(sessionId, "ns-1");

    // The dead client was originally created against ns-1 (counted once).
    mcpServerPool["clientNamespaces"].set(dead, "ns-1");
    mcpServerPool["namespaceConnections"].set("ns-1", 1);

    // Private-method spy: cast through unknown so TS allows spying on the
    // private createNewConnection (the same pattern the other pool tests use).
    const poolWithPrivate = mcpServerPool as unknown as {
      createNewConnection: (typeof mcpServerPool)["createNewConnection"];
    };
    vi.spyOn(poolWithPrivate, "createNewConnection").mockResolvedValue(live);

    const session = await mcpServerPool.getSession(
      sessionId,
      "server-1",
      params,
      "ns-1",
    );

    expect(session).toBe(live);
    // Invalidating the dead client decremented the counter...
    // (the fresh client's increment is simulated by createNewConnection stub not
    // running the real accounting, so the net observable is: the dead client's
    // count was released, leaving 0).
    expect(mcpServerPool["namespaceConnections"].get("ns-1")).toBe(0);
    // The WeakMap entry for the dead client was released (no stale pointer).
    expect(mcpServerPool["clientNamespaces"].has(dead)).toBe(false);
  });

  it("does not double-decrement a namespace when the same client is released twice", () => {
    const dead = makeDeadClient();
    mcpServerPool["clientNamespaces"].set(dead, "ns-1");
    mcpServerPool["namespaceConnections"].set("ns-1", 2);

    mcpServerPool["releaseClientNamespace"](dead);
    mcpServerPool["releaseClientNamespace"](dead);

    expect(mcpServerPool["namespaceConnections"].get("ns-1")).toBe(1);
  });
});
