import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { type ConnectedClient, connectMetaMcpClient } from "./client";
import { McpServerPool, mcpServerPool } from "./mcp-server-pool";

vi.mock("./client", () => ({
  connectMetaMcpClient: vi.fn(),
}));

vi.mock("../config.service", () => ({
  configService: { getSessionLifetime: vi.fn().mockResolvedValue(900_000) },
}));

vi.mock("./log-store", () => ({
  metamcpLogStore: { addLog: vi.fn() },
}));

vi.mock("./server-error-tracker", () => ({
  serverErrorTracker: {
    isServerInErrorState: vi.fn().mockResolvedValue(false),
    resetServerErrorState: vi.fn().mockResolvedValue(undefined),
    recordServerCrash: vi.fn().mockResolvedValue(undefined),
  },
}));

const PoolConstructor = McpServerPool as unknown as new (
  defaultIdleCount: number,
  maxTotalConnections: number,
  maxConnectionsPerServer: number,
) => McpServerPool;

const makePool = (maxTotal = 10, maxPerServer = 5) =>
  new PoolConstructor(1, maxTotal, maxPerServer);

const makeParams = (uuid: string, forward_headers?: Record<string, string>) =>
  ({
    uuid,
    name: uuid,
    type: "STDIO",
    command: "node",
    args: [],
    env: {},
    headers: {},
    forward_headers,
  }) as never;

const makeClient = (): ConnectedClient => ({
  client: { ping: vi.fn().mockResolvedValue(undefined) } as never,
  cleanup: vi.fn().mockResolvedValue(undefined),
});

describe("McpServerPool connection accounting", () => {
  const pools: McpServerPool[] = [];

  const createPool = (maxTotal?: number, maxPerServer?: number) => {
    const pool = makePool(maxTotal, maxPerServer);
    pools.push(pool);
    return pool;
  };

  beforeEach(() => {
    vi.mocked(connectMetaMcpClient).mockReset();
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.cleanupAll()));
  });

  afterAll(async () => {
    await mcpServerPool.cleanupAll();
  });

  it("counts a shared client once and closes it only after its final lease", async () => {
    const pool = createPool(10, 1);
    const client = makeClient();
    vi.mocked(connectMetaMcpClient).mockResolvedValue(client);

    const first = await pool.getSession(
      "session-a",
      "server-a",
      makeParams("server-a"),
    );
    const second = await pool.getSession(
      "session-b",
      "server-a",
      makeParams("server-a"),
    );

    expect(second).toBe(first);
    expect(pool.getPoolStatus().active).toBe(1);
    expect(pool.getPoolStatus().perServerCounts?.["server-a"]).toBe(1);

    await pool.cleanupSession("session-a");
    expect(client.cleanup).not.toHaveBeenCalled();

    await Promise.all([
      pool.cleanupSession("session-b"),
      pool.cleanupSession("session-b"),
    ]);
    expect(client.cleanup).not.toHaveBeenCalled();

    await pool.cleanupAll();
    expect(client.cleanup).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent startup instead of refusing sessions while a server connects", async () => {
    const pool = createPool(10, 1);
    const client = makeClient();
    let resolveConnection!: (value: ConnectedClient) => void;
    vi.mocked(connectMetaMcpClient).mockImplementationOnce(
      () => new Promise((resolve) => (resolveConnection = resolve)),
    );

    const firstPromise = pool.getSession(
      "session-a",
      "server-a",
      makeParams("server-a"),
    );
    await Promise.resolve();
    const secondPromise = pool.getSession(
      "session-b",
      "server-a",
      makeParams("server-a"),
    );
    await Promise.resolve();
    resolveConnection(client);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBe(client);
    expect(second).toBe(client);
    expect(connectMetaMcpClient).toHaveBeenCalledTimes(1);
    expect(pool.getPoolStatus().perServerCounts?.["server-a"]).toBe(1);
  });

  it("does not hand a discarded startup connection to another session", async () => {
    const pool = createPool(10, 1);
    const discardedClient = makeClient();
    const replacementClient = makeClient();
    let resolveConnection!: (value: ConnectedClient) => void;
    vi.mocked(connectMetaMcpClient)
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveConnection = resolve)),
      )
      .mockResolvedValueOnce(replacementClient);

    const firstPromise = pool.getSession(
      "session-a",
      "server-a",
      makeParams("server-a"),
    );
    await Promise.resolve();
    const secondPromise = pool.getSession(
      "session-b",
      "server-a",
      makeParams("server-a"),
    );
    await Promise.resolve();
    await pool.cleanupSession("session-a");
    resolveConnection(discardedClient);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBeUndefined();
    expect(discardedClient.cleanup).toHaveBeenCalledTimes(1);
    expect(second).toBe(replacementClient);
  });

  it("does not share clients that carry per-client forwarded headers", async () => {
    const pool = createPool(10, 1);
    const client = makeClient();
    vi.mocked(connectMetaMcpClient).mockResolvedValue(client);
    const params = makeParams("server-a", { "x-tenant": "x-tenant" });

    const first = await pool.getSession("session-a", "server-a", params);
    const second = await pool.getSession("session-b", "server-a", params);

    expect(first).toBe(client);
    expect(second).toBeUndefined();
    expect(connectMetaMcpClient).toHaveBeenCalledTimes(1);
  });

  it("reserves global capacity before concurrent connection startup", async () => {
    const pool = createPool(1, 5);
    const client = makeClient();
    let resolveConnection!: (value: ConnectedClient) => void;
    vi.mocked(connectMetaMcpClient).mockImplementationOnce(
      () => new Promise((resolve) => (resolveConnection = resolve)),
    );

    const firstPromise = pool.getSession(
      "session-a",
      "server-a",
      makeParams("server-a"),
    );
    await Promise.resolve();
    const second = await pool.getSession(
      "session-b",
      "server-b",
      makeParams("server-b"),
    );

    expect(second).toBeUndefined();
    resolveConnection(client);
    expect(await firstPromise).toBe(client);
    expect(connectMetaMcpClient).toHaveBeenCalledTimes(1);
  });

  it("invalidates active clients when server configuration changes", async () => {
    const pool = createPool(10, 1);
    const oldClient = makeClient();
    const refreshedClient = makeClient();
    vi.mocked(connectMetaMcpClient)
      .mockResolvedValueOnce(oldClient)
      .mockResolvedValueOnce(refreshedClient);

    await pool.getSession("session-a", "server-a", makeParams("server-a"));
    await pool.invalidateIdleSession("server-a", makeParams("server-a"));
    const current = await pool.getSession(
      "session-a",
      "server-a",
      makeParams("server-a"),
    );

    expect(oldClient.cleanup).toHaveBeenCalledTimes(1);
    expect(current).toBe(refreshedClient);
  });

  it("invalidates a shared physical connection only once", async () => {
    const pool = createPool(10, 1);
    const client = makeClient();
    vi.mocked(connectMetaMcpClient).mockResolvedValue(client);

    await pool.getSession("session-a", "server-a", makeParams("server-a"));
    await pool.getSession("session-b", "server-a", makeParams("server-a"));
    await pool.invalidateServerConnection("session-a", "server-a");

    expect(client.cleanup).toHaveBeenCalledTimes(1);
    expect(pool.getPoolStatus().perServerCounts?.["server-a"]).toBe(0);
    await pool.cleanupSession("session-a");
    await pool.cleanupSession("session-b");
    expect(client.cleanup).toHaveBeenCalledTimes(1);
  });
});
