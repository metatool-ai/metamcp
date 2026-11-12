import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mcpServersTable,
  namespaceServerMappingsTable,
  namespacesTable,
} from "../../schema";

// Record the transaction config and every select the export snapshot issues.
// The db connection is faked; each select resolves to the next queued result.
const transactionConfigs: unknown[] = [];
const selects: { fields: Record<string, unknown>; joins: unknown[] }[] = [];
let queuedResults: unknown[][] = [];

function fakeSelect(fields: Record<string, unknown>) {
  const query = { fields, joins: [] as unknown[] };
  selects.push(query);
  const builder = {
    from: () => builder,
    innerJoin: (table: unknown) => {
      query.joins.push(table);
      return builder;
    },
    where: () => Promise.resolve(queuedResults.shift() ?? []),
  };
  return builder;
}

vi.mock("../../index", () => {
  return {
    db: {
      transaction: (
        callback: (tx: { select: typeof fakeSelect }) => Promise<unknown>,
        config: unknown,
      ) => {
        transactionConfigs.push(config);
        return callback({ select: fakeSelect });
      },
    },
  };
});

// Import AFTER vi.mock so the repo binds to the fake db.
const { namespacesRepository } = await import("../namespaces.repo");

const NAMESPACE_ROW = {
  uuid: "ns-uuid",
  name: "release-manager",
  description: null,
  created_at: new Date("2026-07-31T10:00:00.000Z"),
  updated_at: new Date("2026-07-31T10:00:00.000Z"),
  user_id: "user-1",
};

describe("NamespacesRepository.findExportSnapshotByUuid", () => {
  beforeEach(() => {
    transactionConfigs.length = 0;
    selects.length = 0;
    queuedResults = [];
  });

  it("reads in one read-only, repeatable read transaction", async () => {
    queuedResults = [[NAMESPACE_ROW], [], []];

    await namespacesRepository.findExportSnapshotByUuid("ns-uuid");

    expect(transactionConfigs).toEqual([
      { isolationLevel: "repeatable read", accessMode: "read only" },
    ]);
    expect(selects).toHaveLength(3);
  });

  it("returns null and stops when the namespace does not exist", async () => {
    queuedResults = [[]];

    const result =
      await namespacesRepository.findExportSnapshotByUuid("missing");

    expect(result).toBeNull();
    expect(selects).toHaveLength(1);
  });

  it("never selects server connection config", async () => {
    queuedResults = [[NAMESPACE_ROW], [], []];

    await namespacesRepository.findExportSnapshotByUuid("ns-uuid");

    const secretColumns = [
      mcpServersTable.env,
      mcpServersTable.bearerToken,
      mcpServersTable.headers,
    ];
    for (const { fields } of selects) {
      for (const column of Object.values(fields)) {
        expect(secretColumns).not.toContain(column);
      }
    }
    expect(Object.keys(selects[1]?.fields ?? {})).toEqual(["name", "status"]);
  });

  it("exports only tools whose server is still in the namespace", async () => {
    queuedResults = [[NAMESPACE_ROW], [], []];

    await namespacesRepository.findExportSnapshotByUuid("ns-uuid");

    expect(selects[0]?.fields.uuid).toBe(namespacesTable.uuid);
    expect(selects[2]?.joins).toContain(namespaceServerMappingsTable);
  });

  it("returns the namespace, servers and tools it read", async () => {
    const server = { name: "github", status: "ACTIVE" };
    const tool = {
      name: "delete_repository",
      serverName: "github",
      status: "INACTIVE",
      overrideName: null,
      overrideTitle: null,
      overrideDescription: null,
      overrideAnnotations: null,
    };
    queuedResults = [[NAMESPACE_ROW], [server], [tool]];

    const result =
      await namespacesRepository.findExportSnapshotByUuid("ns-uuid");

    expect(result).toEqual({
      namespace: NAMESPACE_ROW,
      servers: [server],
      tools: [tool],
    });
  });
});
