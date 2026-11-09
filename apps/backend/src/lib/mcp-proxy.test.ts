import { describe, expect, it } from "vitest";

import { getHttpStatusCode, getProxyErrorData } from "./mcp-proxy";

describe("mcpProxy HTTP status propagation", () => {
  it("preserves the MCP SDK StreamableHTTPError 401 stored in code", () => {
    const error = Object.assign(new Error("Unauthorized"), {
      name: "StreamableHTTPError",
      code: 401,
    });

    expect(getHttpStatusCode(error)).toBe(401);
    expect(getProxyErrorData(error)).toEqual({ httpStatus: 401 });
  });

  it("supports status and statusCode variants", () => {
    expect(getProxyErrorData({ status: 401 })).toEqual({ httpStatus: 401 });
    expect(getProxyErrorData({ statusCode: 403 })).toEqual({ httpStatus: 403 });
  });

  it("finds an HTTP status on a wrapped cause", () => {
    const error = new Error("proxy wrapper", {
      cause: Object.assign(new Error("Unauthorized"), { code: 401 }),
    });

    expect(getProxyErrorData(error)).toEqual({ httpStatus: 401 });
  });

  it("does not confuse JSON-RPC application codes with HTTP statuses", () => {
    expect(getProxyErrorData({ code: -32001 })).toBeUndefined();
    expect(getProxyErrorData(new Error("Invalid request"))).toBeUndefined();
  });

  it("handles circular cause chains", () => {
    const first = new Error("first") as Error & { cause?: unknown };
    const second = new Error("second") as Error & { cause?: unknown };
    first.cause = second;
    second.cause = first;

    expect(getHttpStatusCode(first)).toBeUndefined();
  });
});
