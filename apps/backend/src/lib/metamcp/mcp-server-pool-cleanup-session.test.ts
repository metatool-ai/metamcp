/** Regression tests for cap-reuse ownership during public session deletion. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub backend connection/configuration imports so these ownership tests
// do not require PostgreSQL or a real upstream MCP.
vi.mock("./client", () => ({
  connectMetaMcpClient: vi.fn(),
}));
vi.mock("../config.service", () => ({
  configService: {
    getSessionLifetime: vi.fn().mockResolvedValue(null),
    getMaxConnections: vi.fn().mockResolvedValue(100),
    getMaxConnectionsPerServer: vi.fn().mockResolvedValue(5),
    getMcpTimeout: vi.fn().mockResolvedValue(60000),
    getMcpMaxTotalTimeout: vi.fn().mockResolvedValue(60000),
    getMcpResetTimeoutOnProgress: vi.fn().mockResolvedValue(true),
    getMaxAttempts: vi.fn().mockResolvedValue(3),
  },
}));
vi.mock("../../db/repositories/mcp-servers.repo", () => ({
  mcpServersRepository: {},
}));
vi.mock("./server-error-tracker", () => ({
  serverErrorTracker: {
    recordServerCrash: vi.fn(),
    resetServerAttempts: vi.fn(),
    markSuccess: vi.fn(),
    getServerAttempts: vi.fn().mockReturnValue(0),
    isServerInErrorState: vi.fn().mockResolvedValue(false),
    resetServerErrorState: vi.fn(),
  },
}));

import { McpServerPool } from "./mcp-server-pool";

// Bypass the private-constructor discipline once, file-wide, without a
// TS2673 per instantiation. Tests poke internals; the singleton
// accessor would leak state across describes.
const PoolConstructor = McpServerPool as unknown as new (
  defaultIdleCount?: number,
  maxTotalConnections?: number,
  maxConnectionsPerServer?: number,
) => McpServerPool;

type FakeClient = {
  cleanup: ReturnType<typeof vi.fn<() => Promise<void>>>;
  closed: boolean;
  listChangedSubscribers: Set<() => void | Promise<void>>;
};

function makeFakeClient(): FakeClient {
  const fake: FakeClient = {
    cleanup: vi.fn(async () => {
      fake.closed = true;
      fake.listChangedSubscribers.clear();
    }),
    closed: false,
    listChangedSubscribers: new Set(),
  };
  return fake;
}

type Internals = {
  activeSessions: Record<string, Record<string, FakeClient>>;
  idleSessions: Record<string, FakeClient>;
  sessionToServers: Record<string, Set<string>>;
  sessionTimestamps: Record<string, number>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("McpServerPool.cleanupSession shared connection ownership", () => {
  let pool: McpServerPool;
  let internals: Internals;

  beforeEach(() => {
    vi.useFakeTimers();
    pool = new PoolConstructor();
    internals = pool as unknown as Internals;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function session(id: string, clients: Record<string, FakeClient>) {
    internals.activeSessions[id] = clients;
    internals.sessionToServers[id] = new Set(Object.keys(clients));
    internals.sessionTimestamps[id] = 1;
  }

  it("preserves the client borrowed through getSession at the per-server cap", async () => {
    pool = new PoolConstructor(1, 100, 1);
    internals = pool as unknown as Internals;
    const shared = makeFakeClient();
    session("owner", { server: shared });
    const borrowed = await pool.getSession("borrower", "server", {
      uuid: "server",
      name: "fixture",
      description: "dummy STDIO fixture",
      type: "STDIO",
      stderr: "ignore",
      created_at: "2026-01-01T00:00:00Z",
      status: "ACTIVE",
    });
    expect(borrowed).toBe(shared);
    internals.idleSessions.server = makeFakeClient();

    await pool.cleanupSession("owner");

    expect(shared.cleanup).not.toHaveBeenCalled();
    expect(internals.activeSessions.borrower.server).toBe(shared);
    expect(shared.closed).toBe(false);
  });

  it("does not close a borrower when another session is deleted with idle occupied", async () => {
    const shared = makeFakeClient();
    const idle = makeFakeClient();
    session("owner", { server: shared });
    session("borrower", { server: shared });
    internals.idleSessions.server = idle;

    await pool.cleanupSession("owner");

    expect(shared.cleanup).not.toHaveBeenCalled();
    expect(shared.closed).toBe(false);
    expect(internals.activeSessions.borrower.server).toBe(shared);
    expect(internals.idleSessions.server).toBe(idle);
    expect(internals.activeSessions.owner).toBeUndefined();
    expect(internals.sessionToServers.owner).toBeUndefined();
    expect(internals.sessionTimestamps.owner).toBeUndefined();
  });

  it("does not publish a still-borrowed client into an empty idle slot", async () => {
    const shared = makeFakeClient();
    session("owner", { server: shared });
    session("borrower", { server: shared });
    await pool.cleanupSession("owner");
    expect(internals.idleSessions.server).toBeUndefined();
    expect(shared.cleanup).not.toHaveBeenCalled();
  });

  it("recycles the client only after its last owner releases it", async () => {
    const shared = makeFakeClient();
    session("owner", { server: shared });
    session("borrower", { server: shared });
    await pool.cleanupSession("owner");
    await pool.cleanupSession("borrower");
    expect(internals.idleSessions.server).toBe(shared);
    expect(shared.cleanup).not.toHaveBeenCalled();
    expect(internals.activeSessions).toEqual({});
  });

  it("destroys the final released client once when another idle client exists", async () => {
    const shared = makeFakeClient();
    session("owner", { server: shared });
    session("borrower", { server: shared });
    internals.idleSessions.server = makeFakeClient();
    await Promise.all([
      pool.cleanupSession("owner"),
      pool.cleanupSession("borrower"),
    ]);
    expect(shared.cleanup).toHaveBeenCalledTimes(1);
    expect(internals.activeSessions).toEqual({});
  });

  it("does not close a connection already retained by the idle pool", async () => {
    const shared = makeFakeClient();
    session("owner", { server: shared });
    internals.idleSessions.server = shared;
    await pool.cleanupSession("owner");
    expect(shared.cleanup).not.toHaveBeenCalled();
    expect(internals.idleSessions.server).toBe(shared);
  });

  it("removes a legacy idle alias while another active borrower remains", async () => {
    const shared = makeFakeClient();
    session("owner", { server: shared });
    session("borrower", { server: shared });
    internals.idleSessions.server = shared;
    await pool.cleanupSession("owner");
    expect(internals.idleSessions.server).toBeUndefined();
    expect(shared.cleanup).not.toHaveBeenCalled();
    await pool.cleanupSession("borrower");
    expect(internals.idleSessions.server).toBe(shared);
  });

  it("detaches a session before slow teardown so repeated DELETE cannot close twice", async () => {
    const gate = deferred();
    const active = makeFakeClient();
    active.cleanup.mockImplementation(() => gate.promise);
    session("owner", { server: active });
    internals.idleSessions.server = makeFakeClient();
    const first = pool.cleanupSession("owner");
    const second = pool.cleanupSession("owner");
    gate.resolve();
    await Promise.all([first, second]);
    expect(active.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "settles concurrent final releases once despite earlier slow clients, idle=%s",
    async (occupied) => {
      const gate = deferred();
      const slowA = makeFakeClient();
      const slowB = makeFakeClient();
      slowA.cleanup.mockImplementation(() => gate.promise);
      slowB.cleanup.mockImplementation(() => gate.promise);
      const shared = makeFakeClient();
      session("owner", { slowA, shared });
      session("borrower", { slowB, shared });
      internals.idleSessions.slowA = makeFakeClient();
      internals.idleSessions.slowB = makeFakeClient();
      if (occupied) internals.idleSessions.shared = makeFakeClient();
      const pending = Promise.all([
        pool.cleanupSession("owner"),
        pool.cleanupSession("borrower"),
      ]);
      gate.resolve();
      await pending;
      expect(internals.activeSessions).toEqual({});
      if (occupied) expect(shared.cleanup).toHaveBeenCalledTimes(1);
      else {
        expect(shared.cleanup).not.toHaveBeenCalled();
        expect(internals.idleSessions.shared).toBe(shared);
      }
    },
  );

  it("keeps unrelated owners and idle clients while disposing a private connection", async () => {
    const privateClient = makeFakeClient();
    const other = makeFakeClient();
    session("owner", { server: privateClient });
    session("unrelated", { neighbor: other });
    internals.idleSessions.server = makeFakeClient();
    await pool.cleanupSession("owner");
    expect(privateClient.cleanup).toHaveBeenCalledTimes(1);
    expect(internals.activeSessions.unrelated.neighbor).toBe(other);
    expect(other.cleanup).not.toHaveBeenCalled();
  });

  it("isolates failed teardown while removing every released session control", async () => {
    const failed = makeFakeClient();
    failed.cleanup.mockRejectedValue(new Error("fixture close failed"));
    const healthy = makeFakeClient();
    session("owner", { failed, healthy });
    internals.idleSessions.failed = makeFakeClient();
    internals.idleSessions.healthy = makeFakeClient();
    await pool.cleanupSession("owner");
    expect(healthy.cleanup).toHaveBeenCalledTimes(1);
    expect(internals.activeSessions.owner).toBeUndefined();
    expect(internals.sessionToServers.owner).toBeUndefined();
  });

  it("continues ownership decisions after a synchronous teardown failure", async () => {
    const failed = makeFakeClient();
    failed.cleanup.mockImplementation(() => {
      throw new Error("fixture synchronous close failure");
    });
    const healthy = makeFakeClient();
    session("owner", { failed, healthy });
    internals.idleSessions.failed = makeFakeClient();
    internals.idleSessions.healthy = makeFakeClient();
    await pool.cleanupSession("owner");
    expect(failed.cleanup).toHaveBeenCalledTimes(1);
    expect(healthy.cleanup).toHaveBeenCalledTimes(1);
    expect(internals.activeSessions.owner).toBeUndefined();
  });

  it("shutdown destroys a shared connection exactly once after all owners release it", async () => {
    const shared = makeFakeClient();
    session("owner", { server: shared });
    session("borrower", { server: shared });
    await pool.cleanupAll();
    expect(shared.cleanup).toHaveBeenCalledTimes(1);
    expect(internals.activeSessions).toEqual({});
    expect(internals.idleSessions).toEqual({});
  });
});
