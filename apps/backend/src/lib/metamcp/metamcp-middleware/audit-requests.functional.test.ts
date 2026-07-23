import { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/repositories/mcp-request-audit-logs.repo", () => ({
  mcpRequestAuditLogsRepository: {
    create: vi.fn(),
  },
}));

import { createAuditCallToolMiddleware } from "./audit-requests.functional";
import { MetaMCPHandlerContext } from "./functional-middleware";

const baseRequest: CallToolRequest = {
  method: "tools/call",
  params: {
    name: "audit_test__echo",
    arguments: { message: "sensitive input" },
  },
};

const baseContext: MetaMCPHandlerContext = {
  endpointName: "audit-endpoint",
  namespaceUuid: "namespace-uuid",
  sessionId: "session-id",
  auth: {
    method: "api_key",
    apiKeyUuid: "api-key-uuid",
    apiKeyUserId: "user-id",
  },
};

describe("createAuditCallToolMiddleware", () => {
  it("records successful tool calls without arguments or response payload", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({
      createAuditLog,
      resolveToolIdentity: vi.fn().mockResolvedValue({
        mcpServerUuid: "server-uuid",
        mcpServerName: "audit_test",
      }),
    });

    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "sensitive response" }],
    });

    await middleware(handler)(baseRequest, baseContext);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointName: "audit-endpoint",
        namespaceUuid: "namespace-uuid",
        sessionId: "session-id",
        authMethod: "api_key",
        apiKeyUuid: "api-key-uuid",
        apiKeyUserId: "user-id",
        mcpServerUuid: "server-uuid",
        mcpServerName: "audit_test",
        toolName: "audit_test__echo",
        status: "SUCCESS",
      }),
    );
    expect(createAuditLog.mock.calls[0]?.[0]).not.toHaveProperty("arguments");
    expect(createAuditLog.mock.calls[0]?.[0]).not.toHaveProperty("response");
  });

  it("records tool responses marked as errors", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({ createAuditLog });

    const handler = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Access denied" }],
    });

    await middleware(handler)(baseRequest, baseContext);

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "Access denied",
      }),
    );
  });

  it("records thrown tool call errors and rethrows", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const middleware = createAuditCallToolMiddleware({ createAuditLog });
    const handler = vi.fn().mockRejectedValue(new Error("Tool failed"));

    await expect(middleware(handler)(baseRequest, baseContext)).rejects.toThrow(
      "Tool failed",
    );

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "Tool failed",
      }),
    );
  });

  it("records calls denied by inner middleware", async () => {
    const createAuditLog = vi.fn().mockResolvedValue(undefined);
    const auditMiddleware = createAuditCallToolMiddleware({ createAuditLog });
    const deniedHandler = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Denied before handler" }],
    });
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "not called" }],
    });

    await auditMiddleware(deniedHandler)(baseRequest, baseContext);

    expect(handler).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ERROR",
        errorMessage: "Denied before handler",
      }),
    );
  });
});
