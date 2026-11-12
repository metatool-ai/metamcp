import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Authorization regression tests for the tRPC implementations:
//   - upstream OAuth sessions are only readable/writable for accessible servers
//   - `input.user_id` cannot assign resources to other users / make them public
//   - public resources are admin-only to modify; STDIO servers admin-only in
//     multi-tenant mode
//   - tools create/sync require ownership of the target server

const mocks = vi.hoisted(() => ({
  findUserEmailById: vi.fn(),
  server: {
    findByUuid: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteByUuid: vi.fn(),
    bulkCreate: vi.fn(),
    findAllAccessibleToUser: vi.fn(),
  },
  namespace: {
    findByUuid: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteByUuid: vi.fn(),
    findByUuidWithServers: vi.fn(),
  },
  endpoint: {
    findByName: vi.fn(),
    findByUuidWithNamespace: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteByUuid: vi.fn(),
  },
  apiKey: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findAccessibleToUser: vi.fn(),
    findByUserId: vi.fn(),
  },
  oauthSession: {
    findByMcpServerUuid: vi.fn(),
    upsert: vi.fn(),
  },
  tools: {
    findByMcpServerUuid: vi.fn(),
    bulkUpsert: vi.fn(),
    syncTools: vi.fn(),
  },
}));

vi.mock("../lib/user-lookup", () => ({
  findUserEmailById: mocks.findUserEmailById,
}));

vi.mock("../db/repositories", () => ({
  mcpServersRepository: mocks.server,
  namespacesRepository: mocks.namespace,
  endpointsRepository: mocks.endpoint,
  oauthSessionsRepository: mocks.oauthSession,
  toolsRepository: mocks.tools,
  namespaceMappingsRepository: {
    findNamespacesByServerUuid: vi.fn(async () => []),
  },
  ApiKeysRepository: class {
    create = mocks.apiKey.create;
    update = mocks.apiKey.update;
    delete = mocks.apiKey.delete;
    findAccessibleToUser = mocks.apiKey.findAccessibleToUser;
    findByUserId = mocks.apiKey.findByUserId;
  },
}));

vi.mock("../lib/metamcp/mcp-server-pool", () => ({
  mcpServerPool: {
    ensureIdleSessionForNewServer: vi.fn(async () => undefined),
    invalidateIdleSession: vi.fn(async () => undefined),
    cleanupIdleSession: vi.fn(async () => undefined),
  },
}));
vi.mock("../lib/metamcp/metamcp-server-pool", () => ({
  metaMcpServerPool: {
    ensureIdleServerForNewNamespace: vi.fn(async () => undefined),
    invalidateIdleServer: vi.fn(async () => undefined),
    invalidateIdleServers: vi.fn(async () => undefined),
    invalidateOpenApiSessions: vi.fn(async () => undefined),
  },
}));
vi.mock("../lib/metamcp/metamcp-middleware/tool-overrides.functional", () => ({
  clearOverrideCache: vi.fn(),
  mapOverrideNameToOriginal: vi.fn(async (name: string) => name),
}));
vi.mock("../lib/metamcp/server-error-tracker", () => ({
  serverErrorTracker: { resetServerErrorState: vi.fn(async () => undefined) },
}));
vi.mock("../lib/metamcp/utils", () => ({
  convertDbServerToParams: vi.fn(async () => null),
}));
vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { apiKeysImplementations } from "./api-keys.impl";
import { endpointsImplementations } from "./endpoints.impl";
import { mcpServersImplementations } from "./mcp-servers.impl";
import { namespacesImplementations } from "./namespaces.impl";
import { oauthImplementations } from "./oauth.impl";
import { toolsImplementations } from "./tools.impl";

const OWNER = "user-owner";
const OTHER = "user-other";
const ADMIN = "user-admin";
const SERVER_UUID = "00000000-0000-0000-0000-000000000001";
const NAMESPACE_UUID = "00000000-0000-0000-0000-000000000002";

const EMAILS: Record<string, string> = {
  [OWNER]: "owner@example.com",
  [OTHER]: "other@example.com",
  [ADMIN]: "admin@example.com",
};

const ORIGINAL_ADMIN_EMAILS = process.env.METAMCP_ADMIN_EMAILS;

function enableMultiTenant() {
  process.env.METAMCP_ADMIN_EMAILS = "admin@example.com";
}

function server(
  userId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    uuid: SERVER_UUID,
    name: "srv",
    description: null,
    type: "STREAMABLE_HTTP" as const,
    command: null,
    args: [],
    env: { SECRET: "env-secret" },
    url: "https://mcp.example.com/mcp",
    bearerToken: "bearer-secret",
    headers: { "X-Token": "header-secret" },
    forward_headers: {},
    error_status: "NONE" as const,
    created_at: new Date(),
    user_id: userId,
    ...overrides,
  };
}

function oauthSession() {
  return {
    uuid: "sess",
    mcp_server_uuid: SERVER_UUID,
    client_information: { client_id: "cid", client_secret: "client-secret" },
    tokens: { access_token: "access-secret", token_type: "Bearer" },
    code_verifier: "verifier-secret",
    created_at: new Date(),
    updated_at: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.METAMCP_ADMIN_EMAILS;
  mocks.findUserEmailById.mockImplementation(
    async (id: string) => EMAILS[id] ?? null,
  );
});

afterEach(() => {
  if (ORIGINAL_ADMIN_EMAILS === undefined) {
    delete process.env.METAMCP_ADMIN_EMAILS;
  } else {
    process.env.METAMCP_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  }
});

describe("oauth.get / oauth.upsert ownership (finding 1)", () => {
  it("does not return another user's private OAuth session", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    mocks.oauthSession.findByMcpServerUuid.mockResolvedValue(oauthSession());

    const result = await oauthImplementations.get(
      { mcp_server_uuid: SERVER_UUID },
      OTHER,
    );

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.oauthSession.findByMcpServerUuid).not.toHaveBeenCalled();
  });

  it("returns the full session to the owner", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    mocks.oauthSession.findByMcpServerUuid.mockResolvedValue(oauthSession());

    const result = await oauthImplementations.get(
      { mcp_server_uuid: SERVER_UUID },
      OWNER,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tokens?.access_token).toBe("access-secret");
      expect(result.data.code_verifier).toBe("verifier-secret");
    }
  });

  it("redacts tokens and secrets of a public server for non-admins", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));
    mocks.oauthSession.findByMcpServerUuid.mockResolvedValue(oauthSession());

    const result = await oauthImplementations.get(
      { mcp_server_uuid: SERVER_UUID },
      OTHER,
    );

    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
    if (result.success) {
      expect(result.data.tokens).toBeNull();
      expect(result.data.code_verifier).toBeNull();
      expect(result.data.client_information?.client_id).toBe("cid");
    }
  });

  it("returns public server secrets to an admin", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));
    mocks.oauthSession.findByMcpServerUuid.mockResolvedValue(oauthSession());

    const result = await oauthImplementations.get(
      { mcp_server_uuid: SERVER_UUID },
      ADMIN,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tokens?.access_token).toBe("access-secret");
    }
  });

  it("rejects upsert on another user's private server", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));

    const result = await oauthImplementations.upsert(
      { mcp_server_uuid: SERVER_UUID, code_verifier: "attacker" },
      OTHER,
    );

    expect(result.success).toBe(false);
    expect(mocks.oauthSession.upsert).not.toHaveBeenCalled();
  });

  it("rejects upsert on a public server by a non-admin in multi-tenant mode", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));

    const result = await oauthImplementations.upsert(
      { mcp_server_uuid: SERVER_UUID, code_verifier: "attacker" },
      OTHER,
    );

    expect(result.success).toBe(false);
    expect(mocks.oauthSession.upsert).not.toHaveBeenCalled();
  });

  it("allows upsert on a public server in single-tenant mode", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(null));
    mocks.oauthSession.upsert.mockResolvedValue(oauthSession());

    const result = await oauthImplementations.upsert(
      { mcp_server_uuid: SERVER_UUID, code_verifier: "v" },
      OTHER,
    );

    expect(result.success).toBe(true);
    expect(mocks.oauthSession.upsert).toHaveBeenCalled();
  });
});

describe("input.user_id is not trusted (finding 2)", () => {
  it("apiKeys.create rejects assigning a key to another user", async () => {
    await expect(
      apiKeysImplementations.create({ name: "k", user_id: OTHER }, OWNER),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mocks.apiKey.create).not.toHaveBeenCalled();
  });

  it("apiKeys.create rejects public keys from non-admins in multi-tenant mode", async () => {
    enableMultiTenant();
    await expect(
      apiKeysImplementations.create({ name: "k", user_id: null }, OWNER),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.apiKey.create).not.toHaveBeenCalled();
  });

  it("apiKeys.create allows public keys for admins", async () => {
    enableMultiTenant();
    mocks.apiKey.create.mockResolvedValue({
      uuid: "k",
      name: "k",
      key: "sk",
      user_id: null,
      created_at: new Date(),
    });
    await apiKeysImplementations.create({ name: "k", user_id: null }, ADMIN);
    expect(mocks.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null }),
    );
  });

  it("mcpServers.create rejects another user's id", async () => {
    const result = await mcpServersImplementations.create(
      {
        name: "srv",
        type: "STREAMABLE_HTTP",
        url: "https://mcp.example.com/mcp",
        user_id: OTHER,
      } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.server.create).not.toHaveBeenCalled();
  });

  it("mcpServers.update rejects reassigning a server to another user", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    const result = await mcpServersImplementations.update(
      {
        uuid: SERVER_UUID,
        name: "srv",
        type: "STREAMABLE_HTTP",
        url: "https://mcp.example.com/mcp",
        user_id: OTHER,
      } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.server.update).not.toHaveBeenCalled();
  });

  it("namespaces.create rejects another user's id", async () => {
    const result = await namespacesImplementations.create(
      { name: "ns", user_id: OTHER } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.namespace.create).not.toHaveBeenCalled();
  });

  it("endpoints.create rejects another user's id", async () => {
    mocks.endpoint.findByName.mockResolvedValue(undefined);
    mocks.namespace.findByUuid.mockResolvedValue({
      uuid: NAMESPACE_UUID,
      name: "ns",
      user_id: null,
    });
    const result = await endpointsImplementations.create(
      { name: "ep", namespaceUuid: NAMESPACE_UUID, user_id: OTHER } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.endpoint.create).not.toHaveBeenCalled();
  });

  it("keeps the caller as owner when user_id is omitted", async () => {
    mocks.namespace.create.mockResolvedValue({
      uuid: NAMESPACE_UUID,
      name: "ns",
      description: null,
      created_at: new Date(),
      updated_at: new Date(),
      user_id: OWNER,
    });
    const result = await namespacesImplementations.create(
      { name: "ns" } as never,
      OWNER,
    );
    expect(result.success).toBe(true);
    expect(mocks.namespace.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: OWNER }),
    );
  });
});

describe("public resources and STDIO servers (finding 6)", () => {
  it("non-admins cannot update or delete a public MCP server in multi-tenant mode", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));

    const update = await mcpServersImplementations.update(
      {
        uuid: SERVER_UUID,
        name: "srv",
        type: "STREAMABLE_HTTP",
        url: "https://evil.example.com/mcp",
      } as never,
      OTHER,
    );
    const del = await mcpServersImplementations.delete(
      { uuid: SERVER_UUID },
      OTHER,
    );

    expect(update.success).toBe(false);
    expect(del.success).toBe(false);
    expect(mocks.server.update).not.toHaveBeenCalled();
    expect(mocks.server.deleteByUuid).not.toHaveBeenCalled();
  });

  it("admins can delete a public MCP server", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));
    mocks.server.deleteByUuid.mockResolvedValue(server(null));

    const del = await mcpServersImplementations.delete(
      { uuid: SERVER_UUID },
      ADMIN,
    );
    expect(del.success).toBe(true);
  });

  it("non-admins cannot modify public namespaces or endpoints", async () => {
    enableMultiTenant();
    mocks.namespace.findByUuid.mockResolvedValue({
      uuid: NAMESPACE_UUID,
      name: "ns",
      user_id: null,
    });
    mocks.endpoint.findByUuidWithNamespace.mockResolvedValue({
      uuid: "ep",
      name: "ep",
      namespace_uuid: NAMESPACE_UUID,
      user_id: null,
    });

    const nsDelete = await namespacesImplementations.delete(
      { uuid: NAMESPACE_UUID },
      OTHER,
    );
    const epDelete = await endpointsImplementations.delete(
      { uuid: "ep" },
      OTHER,
    );

    expect(nsDelete.success).toBe(false);
    expect(epDelete.success).toBe(false);
    expect(mocks.namespace.deleteByUuid).not.toHaveBeenCalled();
    expect(mocks.endpoint.deleteByUuid).not.toHaveBeenCalled();
  });

  it("api key update/delete only reach public keys for admins", async () => {
    enableMultiTenant();
    mocks.apiKey.update.mockResolvedValue({
      uuid: "k",
      name: "k",
      key: "sk",
      created_at: new Date(),
      is_active: false,
    });

    await apiKeysImplementations.update(
      { uuid: "k", is_active: false } as never,
      OTHER,
    );
    await apiKeysImplementations.delete({ uuid: "k" }, OTHER);
    expect(mocks.apiKey.update).toHaveBeenLastCalledWith(
      "k",
      OTHER,
      expect.anything(),
      { allowPublic: false },
    );
    expect(mocks.apiKey.delete).toHaveBeenLastCalledWith("k", OTHER, {
      allowPublic: false,
    });

    await apiKeysImplementations.delete({ uuid: "k" }, ADMIN);
    expect(mocks.apiKey.delete).toHaveBeenLastCalledWith("k", ADMIN, {
      allowPublic: true,
    });
  });

  it("non-admins cannot create STDIO servers in multi-tenant mode", async () => {
    enableMultiTenant();
    const result = await mcpServersImplementations.create(
      { name: "srv", type: "STDIO", command: "sh", args: [] } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.server.create).not.toHaveBeenCalled();
  });

  it("non-admins cannot switch their server to STDIO in multi-tenant mode", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    const result = await mcpServersImplementations.update(
      {
        uuid: SERVER_UUID,
        name: "srv",
        type: "STDIO",
        command: "sh",
        args: [],
      } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.server.update).not.toHaveBeenCalled();
  });

  it("bulk import with STDIO servers is admin-only in multi-tenant mode", async () => {
    enableMultiTenant();
    const result = await mcpServersImplementations.bulkImport(
      { mcpServers: { evil: { command: "sh" } } } as never,
      OWNER,
    );
    expect(result.success).toBe(false);
    expect(mocks.server.bulkCreate).not.toHaveBeenCalled();
  });

  it("STDIO servers stay available to everyone in single-tenant mode", async () => {
    mocks.server.create.mockResolvedValue(
      server(OWNER, { type: "STDIO", command: "sh", url: null }),
    );
    const result = await mcpServersImplementations.create(
      { name: "srv", type: "STDIO", command: "sh", args: [] } as never,
      OWNER,
    );
    expect(result.success).toBe(true);
  });

  it("redacts secrets of public servers for non-admins", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));

    const asUser = await mcpServersImplementations.get(
      { uuid: SERVER_UUID },
      OTHER,
    );
    const asAdmin = await mcpServersImplementations.get(
      { uuid: SERVER_UUID },
      ADMIN,
    );

    expect(JSON.stringify(asUser)).not.toContain("secret");
    expect(JSON.stringify(asAdmin)).toContain("bearer-secret");
  });
});

describe("tools create/sync ownership (finding 8)", () => {
  const toolsInput = {
    mcpServerUuid: SERVER_UUID,
    tools: [{ name: "t", inputSchema: { type: "object" as const } }],
  };

  it("sync rejects another user's server and deletes nothing", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    const result = await toolsImplementations.sync(toolsInput, OTHER);
    expect(result.success).toBe(false);
    expect(mocks.tools.syncTools).not.toHaveBeenCalled();
  });

  it("create rejects another user's server", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    const result = await toolsImplementations.create(toolsInput, OTHER);
    expect(result.success).toBe(false);
    expect(mocks.tools.bulkUpsert).not.toHaveBeenCalled();
  });

  it("sync on a public server requires admin in multi-tenant mode", async () => {
    enableMultiTenant();
    mocks.server.findByUuid.mockResolvedValue(server(null));
    const result = await toolsImplementations.sync(toolsInput, OTHER);
    expect(result.success).toBe(false);
    expect(mocks.tools.syncTools).not.toHaveBeenCalled();
  });

  it("the owner can sync their server's tools", async () => {
    mocks.server.findByUuid.mockResolvedValue(server(OWNER));
    mocks.tools.syncTools.mockResolvedValue({ upserted: [{}], deleted: [] });
    const result = await toolsImplementations.sync(
      { ...toolsInput, mcpServerUuid: "00000000-0000-0000-0000-0000000000ff" },
      OWNER,
    );
    expect(result.success).toBe(true);
    expect(mocks.tools.syncTools).toHaveBeenCalled();
  });
});
