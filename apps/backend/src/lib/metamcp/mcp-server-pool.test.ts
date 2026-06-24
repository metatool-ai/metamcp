import type { ServerParameters } from "@repo/zod-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedClient } from "./client";
import { connectMetaMcpClient } from "./client";
import { McpServerPool } from "./mcp-server-pool";

vi.mock("./client", () => ({
  connectMetaMcpClient: vi.fn(),
}));

vi.mock("../config.service", () => ({
  configService: {
    getSessionLifetime: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("./server-error-tracker", () => ({
  serverErrorTracker: {
    isServerInErrorState: vi.fn().mockResolvedValue(false),
    recordServerCrash: vi.fn().mockResolvedValue(undefined),
    resetServerErrorState: vi.fn().mockResolvedValue(undefined),
  },
}));

type TestPoolConstructor = typeof McpServerPool & {
  instance: McpServerPool | null;
};

type PoolInternals = McpServerPool & {
  activeSessions: Record<string, Record<string, ConnectedClient>>;
  creatingIdleSessions: Set<string>;
  sessionToServers: Record<string, Set<string>>;
  sessionTimestamps: Record<string, number>;
};

const poolCtor = McpServerPool as TestPoolConstructor;
const connectMock = vi.mocked(connectMetaMcpClient);

const params = {
  uuid: "server-1",
  name: "OpenMessage",
  type: "STDIO",
} as ServerParameters;

function makeClient(label: string): ConnectedClient {
  return {
    label,
    cleanup: vi.fn().mockResolvedValue(undefined),
    client: {
      getServerCapabilities: vi.fn(),
      getServerVersion: vi.fn(),
      request: vi.fn(),
      ping: vi.fn(),
    },
  } as unknown as ConnectedClient;
}

async function resetPoolSingleton(): Promise<void> {
  await poolCtor.instance?.cleanupAll();
  poolCtor.instance = null;
}

beforeEach(async () => {
  delete process.env.MAX_CONNECTIONS_PER_SERVER;
  vi.clearAllMocks();
  await resetPoolSingleton();
});

afterEach(async () => {
  delete process.env.MAX_CONNECTIONS_PER_SERVER;
  await resetPoolSingleton();
});

describe("McpServerPool per-server connection cap", () => {
  it("reads MAX_CONNECTIONS_PER_SERVER from the environment", () => {
    process.env.MAX_CONNECTIONS_PER_SERVER = "20";

    const pool = McpServerPool.getInstance();

    expect(pool.getPoolStatus().maxConnectionsPerServer).toBe(20);
  });

  it("does not create beyond the per-server cap when no active connection can be reused", async () => {
    const pool = McpServerPool.getInstance(0, 1);
    const internals = pool as PoolInternals;
    internals.creatingIdleSessions.add(params.uuid);

    const result = await pool.getSession(
      "session-1",
      params.uuid,
      params,
      "ns-1",
    );

    expect(result).toBeUndefined();
    expect(connectMock).not.toHaveBeenCalled();
    expect(pool.getActiveSessionIds()).toEqual([]);
  });

  it("discards a raced over-cap connection and reuses the existing active connection", async () => {
    const pool = McpServerPool.getInstance(0, 1);
    const internals = pool as PoolInternals;
    const existing = makeClient("existing");
    const raced = makeClient("raced");

    connectMock.mockImplementationOnce(async () => {
      internals.activeSessions["other-session"] = { [params.uuid]: existing };
      internals.sessionToServers["other-session"] = new Set([params.uuid]);
      internals.sessionTimestamps["other-session"] = Date.now() - 1000;
      return raced;
    });

    const result = await pool.getSession(
      "session-1",
      params.uuid,
      params,
      "ns-1",
    );

    expect(result).toBe(existing);
    expect(raced.cleanup).toHaveBeenCalledTimes(1);
    expect(internals.activeSessions["session-1"][params.uuid]).toBe(existing);
  });
});
