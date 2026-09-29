import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerParameters } from "@repo/zod-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerSnapshotRow } from "../../db/repositories/mcp-server-snapshots.repo";

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../config.service", () => ({ configService: {} }));
vi.mock("../../db/repositories/mcp-server-snapshots.repo", () => ({
  mcpServerSnapshotsRepository: {},
}));

import type { ConnectedClient } from "./client";
import {
  listAllTools,
  ServerSnapshots,
  SnapshotStore,
} from "./server-snapshots";

const TTL = 60_000;
const HOUR = 60 * 60 * 1000;

const tool = (name: string): Tool => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
});

const params = (uuid: string, extra: Partial<ServerParameters> = {}) =>
  ({
    uuid,
    name: uuid,
    type: "STDIO",
    command: "server",
    ...extra,
  }) as ServerParameters;

function fakeStore() {
  const rows = new Map<string, McpServerSnapshotRow>();
  const store: SnapshotStore & { rows: typeof rows } = {
    rows,
    findListedSince: vi.fn(async (uuids: string[], since: Date) =>
      uuids
        .map((uuid) => rows.get(uuid))
        .filter(
          (row): row is McpServerSnapshotRow => !!row && row.listed_at >= since,
        ),
    ),
    upsert: vi.fn(async (snapshot) => {
      rows.set(snapshot.mcp_server_uuid, {
        mcp_server_uuid: snapshot.mcp_server_uuid,
        server_info: snapshot.server_info ?? null,
        capabilities: snapshot.capabilities,
        tools: snapshot.tools,
        listed_at: new Date(),
      });
    }),
    deleteByServerUuid: vi.fn(async (uuid: string) => {
      rows.delete(uuid);
    }),
  };
  return store;
}

/** A connected client whose tools/list answers `pages` in order. */
function fakeClient(
  pages: Array<{ tools: Tool[]; nextCursor?: string }>,
  capabilities = { tools: {} },
) {
  const request = vi.fn(
    async () =>
      pages[Math.min(request.mock.calls.length - 1, pages.length - 1)],
  );
  return {
    request,
    client: {
      request,
      getServerVersion: () => ({ name: "memory-server", version: "1.2.3" }),
      getServerCapabilities: () => capabilities,
    } as unknown as ConnectedClient["client"],
    cleanup: vi.fn(),
  };
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ServerSnapshots", () => {
  it("records what a server listed and gives it back within the TTL only", async () => {
    const store = fakeStore();
    const snapshots = new ServerSnapshots(store, TTL);
    const client = fakeClient([]);

    await snapshots.record(params("a"), client, [tool("read"), tool("write")]);

    const fresh = await snapshots.fresh(["a", "b"]);
    expect([...fresh.keys()]).toEqual(["a"]);
    expect(fresh.get("a")).toMatchObject({
      serverInfo: { name: "memory-server", version: "1.2.3" },
      capabilities: { tools: {} },
      // Full definitions: annotations and output schemas are kept
      tools: [tool("read"), tool("write")],
    });

    vi.setSystemTime(Date.now() + TTL + 1);
    expect((await snapshots.fresh(["a"])).size).toBe(0);
  });

  it("never serves nor records servers that forward client headers", async () => {
    const store = fakeStore();
    const snapshots = new ServerSnapshots(store, TTL);
    const forwarding = params("fh", {
      forward_headers: { "x-user-token": "Authorization" },
    });

    expect(snapshots.canUse(forwarding)).toBe(false);
    await snapshots.record(forwarding, fakeClient([]), [tool("read")]);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it("is off with a TTL of 0", async () => {
    const store = fakeStore();
    const snapshots = new ServerSnapshots(store, 0);

    expect(snapshots.enabled).toBe(false);
    expect(snapshots.canUse(params("a"))).toBe(false);
    await snapshots.record(params("a"), fakeClient([]), [tool("read")]);
    expect(store.upsert).not.toHaveBeenCalled();
    expect((await snapshots.fresh(["a"])).size).toBe(0);
    expect(store.findListedSince).not.toHaveBeenCalled();
  });

  it("forgets the snapshot of a server whose configuration changed", async () => {
    const store = fakeStore();
    const snapshots = new ServerSnapshots(store, TTL);
    await snapshots.record(params("a"), fakeClient([]), [tool("read")]);

    await snapshots.forget("a");

    expect((await snapshots.fresh(["a"])).size).toBe(0);
  });

  it("refreshes the snapshot of a server in use at most once per interval", async () => {
    const store = fakeStore();
    const snapshots = new ServerSnapshots(store, 24 * HOUR, HOUR);
    const client = fakeClient([{ tools: [tool("read"), tool("new")] }]);

    snapshots.refreshInBackground(params("a"), client);
    await settle();
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(store.rows.get("a")?.tools.map((t) => t.name)).toEqual([
      "read",
      "new",
    ]);

    // Just refreshed: nothing to do
    snapshots.refreshInBackground(params("a"), client);
    await settle();
    expect(client.request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + HOUR + 1);
    snapshots.refreshInBackground(params("a"), client);
    await settle();
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("does not list servers without tools, and retries a failed refresh", async () => {
    const store = fakeStore();
    const snapshots = new ServerSnapshots(store, 24 * HOUR, HOUR);

    const promptsOnly = fakeClient([{ tools: [] }], { prompts: {} } as never);
    snapshots.refreshInBackground(params("p"), promptsOnly);
    await settle();
    expect(promptsOnly.request).not.toHaveBeenCalled();

    const failing = fakeClient([]);
    failing.request.mockRejectedValueOnce(new Error("Not connected"));
    snapshots.refreshInBackground(params("a"), failing);
    await settle();
    expect(store.upsert).not.toHaveBeenCalled();

    failing.request.mockResolvedValueOnce({ tools: [tool("read")] });
    snapshots.refreshInBackground(params("a"), failing);
    await settle();
    expect(store.rows.get("a")?.tools.map((t) => t.name)).toEqual(["read"]);
  });
});

describe("listAllTools", () => {
  it("reads every page and stops on a repeated cursor", async () => {
    const client = fakeClient([
      { tools: [tool("a")], nextCursor: "1" },
      { tools: [tool("b")], nextCursor: "2" },
      { tools: [tool("c")], nextCursor: "2" },
    ]);

    const tools = await listAllTools(client);

    expect(tools.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.request).toHaveBeenCalledTimes(3);
  });
});
