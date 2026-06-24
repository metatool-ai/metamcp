import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ServerParameters } from "@repo/zod-types";
import { describe, expect, it, vi } from "vitest";

import { getMcpServers } from "../../../lib/metamcp/fetch-metamcp";
import { mcpServerPool } from "../../../lib/metamcp/mcp-server-pool";
import type { MetaMCPHandlerContext } from "../../../lib/metamcp/metamcp-middleware/functional-middleware";
import { createOriginalCallToolHandler } from "./handlers";

vi.mock("../../../lib/metamcp/fetch-metamcp", () => ({
  getMcpServers: vi.fn(),
}));

vi.mock("../../../lib/metamcp/mcp-server-pool", () => ({
  mcpServerPool: {
    getSession: vi.fn(),
  },
}));

vi.mock(
  "../../../lib/metamcp/metamcp-middleware/audit-requests.functional",
  () => ({
    createAuditCallToolMiddleware: vi.fn(),
  }),
);

vi.mock(
  "../../../lib/metamcp/metamcp-middleware/filter-tools.functional",
  () => ({
    createFilterCallToolMiddleware: vi.fn(),
    createFilterListToolsMiddleware: vi.fn(),
  }),
);

vi.mock(
  "../../../lib/metamcp/metamcp-middleware/tool-overrides.functional",
  () => ({
    createToolOverridesCallToolMiddleware: vi.fn(),
    createToolOverridesListToolsMiddleware: vi.fn(),
  }),
);

vi.mock("../../../lib/metamcp/metamcp-middleware/tool-identity", () => ({
  resolveToolIdentity: vi.fn(),
}));

vi.mock("../../../lib/metamcp/utils", () => ({
  sanitizeName: (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, ""),
}));

vi.mock("../../../lib/config.service", () => ({
  configService: {
    getMcpMaxTotalTimeout: vi.fn(),
    getMcpResetTimeoutOnProgress: vi.fn(),
    getMcpTimeout: vi.fn(),
  },
}));

const callRequest: CallToolRequest = {
  method: "tools/call",
  params: {
    name: "OpenMessage__relay_get_runtime_config",
    arguments: {},
  },
};

const context: MetaMCPHandlerContext = {
  endpointName: "test-endpoint",
  namespaceUuid: "namespace-1",
  sessionId: "session-1",
};

describe("OpenAPI createOriginalCallToolHandler", () => {
  it("does not report a matched server with no live session as an unknown tool", async () => {
    vi.mocked(getMcpServers).mockResolvedValue({
      "server-1": {
        uuid: "server-1",
        name: "OpenMessage",
        type: "STDIO",
      } as ServerParameters,
    });
    vi.mocked(mcpServerPool.getSession).mockResolvedValue(undefined);

    const handler = createOriginalCallToolHandler();

    await expect(handler(callRequest, context)).rejects.toThrow(
      /downstream MCP session/i,
    );
    await expect(handler(callRequest, context)).rejects.not.toThrow(
      /Unknown tool/,
    );
  });
});
