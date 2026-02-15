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
  extractClientHeaders,
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
  it("should extract matching headers with case-insensitive lookup", () => {
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

  it("should skip servers without forward_headers or with empty array", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "x-key": "value",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "no-forward",
        // no forward_headers
      }),
      "server-2": makeServer({
        uuid: "server-2",
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

  it("should return empty for empty client headers or empty server params", () => {
    const serverWithHeaders: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "octopus",
        forward_headers: ["X-Octopus-ApiKey"],
      }),
    };

    expect(extractForwardedHeaders({}, serverWithHeaders)).toEqual({});
    expect(extractForwardedHeaders({ "x-key": "value" }, {})).toEqual({});
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

    expect(result).toEqual({
      "server-1": { "X-API-Key": "legit-key" },
    });
  });

  it("should block proxy-* and sec-* prefixed headers", () => {
    const clientHeaders: Record<string, string | string[] | undefined> = {
      "proxy-connection": "keep-alive",
      "proxy-authenticate": "Basic",
      "sec-fetch-dest": "document",
      "sec-ch-ua": '"Chrome"',
      "x-api-key": "legit",
    };

    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({
        uuid: "server-1",
        name: "test",
        forward_headers: [
          "Proxy-Connection",
          "Proxy-Authenticate",
          "Sec-Fetch-Dest",
          "Sec-Ch-Ua",
          "X-API-Key",
        ],
      }),
    };

    const result = extractForwardedHeaders(clientHeaders, serverParams);
    expect(result).toEqual({
      "server-1": { "X-API-Key": "legit" },
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

  it("should handle undefined/null inputs gracefully", () => {
    expect(mergeHeaders(null, { "X-Forwarded": "value" })).toEqual({
      "X-Forwarded": "value",
    });
    expect(mergeHeaders(undefined, { "X-Forwarded": "value" })).toEqual({
      "X-Forwarded": "value",
    });
    expect(mergeHeaders({ "X-Static": "value" }, undefined)).toEqual({
      "X-Static": "value",
    });
    expect(mergeHeaders(undefined, undefined)).toEqual({});
  });
});

describe("serverRequiresForwardedHeaders", () => {
  it("should return true when forward_headers has entries", () => {
    expect(
      serverRequiresForwardedHeaders(
        makeServer({ uuid: "s1", name: "test", forward_headers: ["X-Api-Key"] }),
      ),
    ).toBe(true);
  });

  it("should return false when forward_headers is empty or undefined", () => {
    expect(
      serverRequiresForwardedHeaders(
        makeServer({ uuid: "s1", name: "test", forward_headers: [] }),
      ),
    ).toBe(false);
    expect(
      serverRequiresForwardedHeaders(
        makeServer({ uuid: "s1", name: "test" }),
      ),
    ).toBe(false);
  });
});

describe("anyServerRequiresForwardedHeaders", () => {
  it("should return true when at least one server has forward_headers", () => {
    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({ uuid: "server-1", name: "no-forward", forward_headers: [] }),
      "server-2": makeServer({ uuid: "server-2", name: "has-forward", forward_headers: ["Authorization"] }),
    };

    expect(anyServerRequiresForwardedHeaders(serverParams)).toBe(true);
  });

  it("should return false when no servers have forward_headers", () => {
    const serverParams: Record<string, ServerParameters> = {
      "server-1": makeServer({ uuid: "server-1", name: "no-forward", forward_headers: [] }),
      "server-2": makeServer({ uuid: "server-2", name: "also-no-forward" }),
    };

    expect(anyServerRequiresForwardedHeaders(serverParams)).toBe(false);
    expect(anyServerRequiresForwardedHeaders({})).toBe(false);
  });
});

describe("sanitizeHeaderValue", () => {
  it("should strip \\r, \\n, and null-byte characters", () => {
    expect(sanitizeHeaderValue("hello\r\nworld")).toBe("helloworld");
    expect(sanitizeHeaderValue("val\0ue")).toBe("value");
    expect(sanitizeHeaderValue("a\r\n\0b")).toBe("ab");
  });

  it("should return clean values unchanged", () => {
    expect(sanitizeHeaderValue("Bearer abc123")).toBe("Bearer abc123");
    expect(sanitizeHeaderValue("")).toBe("");
  });
});

describe("extractClientHeaders", () => {
  it("should normalize string, array, and undefined header values", () => {
    const result = extractClientHeaders({
      authorization: "Bearer token",
      "set-cookie": ["a=1", "b=2"],
      host: "example.com",
      "x-undef": undefined,
    });

    expect(result).toEqual({
      authorization: "Bearer token",
      "set-cookie": "a=1, b=2",
      host: "example.com",
    });
  });

  it("should return empty object for empty headers", () => {
    expect(extractClientHeaders({})).toEqual({});
  });
});
