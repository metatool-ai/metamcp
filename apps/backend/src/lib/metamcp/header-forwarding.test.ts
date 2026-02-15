import { ServerParameters } from "@repo/zod-types";
import { describe, expect, it, vi } from "vitest";

// Mock logger to avoid path alias resolution issues in tests
vi.mock("@/utils/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  anyServerRequiresForwardedHeaders,
  extractForwardedHeaders,
  mergeHeaders,
  sanitizeHeaderValue,
  serverRequiresForwardedHeaders,
} from "./header-forwarding";

// Helper to create minimal ServerParameters
function makeServer(
  overrides: Partial<ServerParameters> & { uuid: string; name: string },
): ServerParameters {
  return {
    description: "",
    type: "STREAMABLE_HTTP",
    created_at: new Date().toISOString(),
    status: "active",
    stderr: "inherit" as const,
    url: "http://example.com/mcp",
    headers: {},
    ...overrides,
  };
}

describe("extractForwardedHeaders", () => {
  it("should extract matching headers from client request", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-octopus-apikey": "API-123",
      authorization: "Bearer user-token",
      "content-type": "application/json",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "octopus",
        forward_headers: ["X-Octopus-ApiKey"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": { "X-Octopus-ApiKey": "API-123" },
    });
  });

  it("should handle case-insensitive header matching", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-custom-auth": "my-secret",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "my-server",
        forward_headers: ["X-Custom-Auth"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": { "X-Custom-Auth": "my-secret" },
    });
  });

  it("should handle multiple servers with different forward_headers", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-octopus-apikey": "API-123",
      "x-azure-token": "az-token-456",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "octopus",
        forward_headers: ["X-Octopus-ApiKey"],
      }),
      "server-2": makeServer({
        uuid: "server-2",
        name: "azure",
        forward_headers: ["X-Azure-Token"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": { "X-Octopus-ApiKey": "API-123" },
      "server-2": { "X-Azure-Token": "az-token-456" },
    });
  });

  it("should skip servers without forward_headers", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-octopus-apikey": "API-123",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "octopus",
        forward_headers: ["X-Octopus-ApiKey"],
      }),
      "server-2": makeServer({
        uuid: "server-2",
        name: "no-forwarding",
        // no forward_headers
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": { "X-Octopus-ApiKey": "API-123" },
    });
  });

  it("should skip servers with empty forward_headers array", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-key": "value",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "empty-forward",
        forward_headers: [],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({});
  });

  it("should omit servers when client does not provide matching headers", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "content-type": "application/json",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "octopus",
        forward_headers: ["X-Octopus-ApiKey"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({});
  });

  it("should handle array header values by taking the first element", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-multi": ["first-value", "second-value"],
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "multi-header",
        forward_headers: ["X-Multi"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": { "X-Multi": "first-value" },
    });
  });

  it("should handle multiple forward_headers for the same server", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-api-key": "key-123",
      "x-tenant-id": "tenant-456",
      "x-region": "eu-west",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "multi-header-server",
        forward_headers: ["X-API-Key", "X-Tenant-Id", "X-Region"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": {
        "X-API-Key": "key-123",
        "X-Tenant-Id": "tenant-456",
        "X-Region": "eu-west",
      },
    });
  });

  it("should handle empty client headers", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {};

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "octopus",
        forward_headers: ["X-Octopus-ApiKey"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({});
  });

  it("should handle empty server params", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-key": "value",
    };

    const result = extractForwardedHeaders(clientHeaders, {});

    expect(result).toEqual({});
  });
});

describe("mergeHeaders", () => {
  it("should merge static and forwarded headers", () => {
    const result = mergeHeaders(
      { "X-Static": "static-value" },
      { "X-Forwarded": "forwarded-value" },
    );

    expect(result).toEqual({
      "X-Static": "static-value",
      "X-Forwarded": "forwarded-value",
    });
  });

  it("should let forwarded headers override static headers", () => {
    const result = mergeHeaders(
      { "X-Api-Key": "admin-default-key" },
      { "X-Api-Key": "user-specific-key" },
    );

    expect(result).toEqual({
      "X-Api-Key": "user-specific-key",
    });
  });

  it("should handle null static headers", () => {
    const result = mergeHeaders(null, { "X-Forwarded": "value" });

    expect(result).toEqual({ "X-Forwarded": "value" });
  });

  it("should handle undefined static headers", () => {
    const result = mergeHeaders(undefined, { "X-Forwarded": "value" });

    expect(result).toEqual({ "X-Forwarded": "value" });
  });

  it("should handle undefined forwarded headers", () => {
    const result = mergeHeaders({ "X-Static": "value" }, undefined);

    expect(result).toEqual({ "X-Static": "value" });
  });

  it("should handle both undefined", () => {
    const result = mergeHeaders(undefined, undefined);

    expect(result).toEqual({});
  });
});

describe("serverRequiresForwardedHeaders", () => {
  it("should return true when forward_headers has entries", () => {
    const params = makeServer({
      uuid: "server-1",
      name: "test",
      forward_headers: ["X-Api-Key"],
    });

    expect(serverRequiresForwardedHeaders(params)).toBe(true);
  });

  it("should return false when forward_headers is empty", () => {
    const params = makeServer({
      uuid: "server-1",
      name: "test",
      forward_headers: [],
    });

    expect(serverRequiresForwardedHeaders(params)).toBe(false);
  });

  it("should return false when forward_headers is undefined", () => {
    const params = makeServer({
      uuid: "server-1",
      name: "test",
    });

    expect(serverRequiresForwardedHeaders(params)).toBe(false);
  });
});

describe("extractForwardedHeaders - security", () => {
  it("should block denied headers even if configured in forward_headers", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      host: "evil.com",
      cookie: "session=abc",
      "x-forwarded-for": "1.2.3.4",
      "x-api-key": "legit-key",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "test",
        forward_headers: [
          "Host",
          "Cookie",
          "X-Forwarded-For",
          "X-API-Key",
        ],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    // Only X-API-Key should be forwarded; denied headers are silently dropped
    expect(result).toEqual({
      "server-1": { "X-API-Key": "legit-key" },
    });
  });

  it("should strip CRLF characters from header values", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-api-key": "value\r\nInjected-Header: evil",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "test",
        forward_headers: ["X-API-Key"],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);

    expect(result).toEqual({
      "server-1": { "X-API-Key": "valueInjected-Header: evil" },
    });
  });
});

describe("sanitizeHeaderValue", () => {
  it("should strip \\r and \\n characters", () => {
    expect(sanitizeHeaderValue("hello\r\nworld")).toBe("helloworld");
    expect(sanitizeHeaderValue("line1\nline2")).toBe("line1line2");
    expect(sanitizeHeaderValue("ok\rvalue")).toBe("okvalue");
  });

  it("should return clean values unchanged", () => {
    expect(sanitizeHeaderValue("Bearer abc123")).toBe("Bearer abc123");
    expect(sanitizeHeaderValue("")).toBe("");
  });
});

describe("anyServerRequiresForwardedHeaders", () => {
  it("should return true when at least one server has forward_headers", () => {
    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "no-forward",
        forward_headers: [],
      }),
      "server-2": makeServer({
        uuid: "server-2",
        name: "has-forward",
        forward_headers: ["Authorization"],
      }),
    };

    expect(anyServerRequiresForwardedHeaders(serverParams)).toBe(true);
  });

  it("should return false when no servers have forward_headers", () => {
    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "no-forward",
        forward_headers: [],
      }),
      "server-2": makeServer({
        uuid: "server-2",
        name: "also-no-forward",
      }),
    };

    expect(anyServerRequiresForwardedHeaders(serverParams)).toBe(false);
  });

  it("should return false for empty server params", () => {
    expect(anyServerRequiresForwardedHeaders({})).toBe(false);
  });
});
