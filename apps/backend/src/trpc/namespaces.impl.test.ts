import type { DatabaseNamespaceWithServers } from "@repo/zod-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vitest hoists vi.mock() above imports so namespaces.impl loads against these
// stubs instead of the real repositories / server pool. The pool and the
// tool-override middleware both pull in db/index (which throws without
// DATABASE_URL) and start timers, so they are mocked out here; the export path
// only touches namespacesRepository.
vi.mock("../db/repositories", () => ({
  namespacesRepository: {
    findByUuidWithServers: vi.fn(),
    findToolsByNamespaceUuid: vi.fn(),
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

const findByUuidWithServers = vi.mocked(
  namespacesRepository.findByUuidWithServers,
);
const findToolsByNamespaceUuid = vi.mocked(
  namespacesRepository.findToolsByNamespaceUuid,
);

function namespaceOwnedBy(userId: string | null): DatabaseNamespaceWithServers {
  return {
    uuid: "ns-uuid",
    name: "release-manager",
    description: null,
    created_at: new Date("2026-07-31T10:00:00.000Z"),
    updated_at: new Date("2026-07-31T10:00:00.000Z"),
    user_id: userId,
    servers: [],
  };
}

describe("namespacesImplementations.export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findToolsByNamespaceUuid.mockResolvedValue([]);
  });

  it("denies exporting a private namespace owned by another user", async () => {
    findByUuidWithServers.mockResolvedValue(namespaceOwnedBy("other-user"));

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("Access denied");
    // Must not read tools for a namespace the caller cannot access.
    expect(findToolsByNamespaceUuid).not.toHaveBeenCalled();
  });

  it("returns not found when the namespace does not exist", async () => {
    findByUuidWithServers.mockResolvedValue(null);

    const result = await namespacesImplementations.export(
      { uuid: "missing" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Namespace not found");
  });

  it("exports a namespace owned by the caller", async () => {
    findByUuidWithServers.mockResolvedValue(namespaceOwnedBy("user-1"));

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(1);
    expect(result.data?.namespace.name).toBe("release-manager");
  });

  it("exports a public namespace for any user", async () => {
    findByUuidWithServers.mockResolvedValue(namespaceOwnedBy(null));

    const result = await namespacesImplementations.export(
      { uuid: "ns-uuid" },
      "some-other-user",
    );

    expect(result.success).toBe(true);
  });
});
