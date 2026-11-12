import {
  ExportNamespaceResponseSchema,
  type NamespaceExportSnapshot,
} from "@repo/zod-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vitest hoists vi.mock() above imports so namespaces.impl loads against these
// stubs instead of the real repositories / server pool. The pool and the
// tool-override middleware both pull in db/index (which throws without
// DATABASE_URL) and start timers, so they are mocked out here; the export path
// only touches namespacesRepository.
vi.mock("../db/repositories", () => ({
  namespacesRepository: {
    findExportSnapshotByUuid: vi.fn(),
  },
  mcpServersRepository: {},
  namespaceMappingsRepository: {},
  toolsRepository: {},
}));

vi.mock("../db/serializers", () => ({
  NamespacesSerializer: {},
}));

vi.mock("../lib/metamcp/metamcp-middleware/tool-overrides.functional", () => ({
  clearOverrideCache: vi.fn(),
  mapOverrideNameToOriginal: vi.fn(),
}));

vi.mock("../lib/metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {},
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { namespacesRepository } from "../db/repositories";
import { namespacesImplementations } from "./namespaces.impl";

const findExportSnapshotByUuid = vi.mocked(
  namespacesRepository.findExportSnapshotByUuid,
);

function namespaceOwnedBy(userId: string | null): NamespaceExportSnapshot {
  return {
    namespace: {
      uuid: "ns-uuid",
      name: "release-manager",
      description: null,
      created_at: new Date("2026-07-31T10:00:00.000Z"),
      updated_at: new Date("2026-07-31T10:00:00.000Z"),
      user_id: userId,
    },
    servers: [],
    tools: [],
  };
}

describe("namespacesImplementations.export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies exporting a private namespace owned by another user", async () => {
    findExportSnapshotByUuid.mockResolvedValue(namespaceOwnedBy("other-user"));

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Access denied");
    // Must not return any namespace data to a caller without access.
    expect(result.data).toBeUndefined();
  });

  it("returns not found when the namespace does not exist", async () => {
    findExportSnapshotByUuid.mockResolvedValue(null);

    const result = await namespacesImplementations.export(
      { uuid: "missing" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Namespace not found");
  });

  it("exports a namespace owned by the caller", async () => {
    findExportSnapshotByUuid.mockResolvedValue(namespaceOwnedBy("user-1"));

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(1);
    expect(result.data?.namespace.name).toBe("release-manager");
  });

  it("exports a public namespace for any user", async () => {
    findExportSnapshotByUuid.mockResolvedValue(namespaceOwnedBy(null));

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "some-other-user",
    );

    expect(result.success).toBe(true);
  });

  it("returns the same document that the tRPC output schema returns", async () => {
    const snapshot = namespaceOwnedBy("user-1");
    snapshot.servers = [{ name: "github", status: "ACTIVE" }];
    snapshot.tools = [
      {
        name: "create_pull_request",
        serverName: "github",
        status: "ACTIVE",
        overrideName: null,
        overrideTitle: null,
        overrideDescription: null,
        // Unknown keys, nested objects and a JSONB-style "__proto__" key.
        overrideAnnotations: JSON.parse(
          '{"__proto__":{"x":1},"zeta":{"b":1,"a":2},"annotationTitle":"PR"}',
        ),
      },
    ];
    findExportSnapshotByUuid.mockResolvedValue(snapshot);

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "user-1",
    );

    // The admin MCP tool returns `result` as-is; tRPC returns the parsed copy.
    expect(JSON.stringify(ExportNamespaceResponseSchema.parse(result))).toBe(
      JSON.stringify(result),
    );
    expect(result.data?.namespace.tools[0]?.override?.annotations).toEqual({
      annotationTitle: "PR",
      zeta: { a: 2, b: 1 },
    });
  });
});
