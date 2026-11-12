import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { listStrictError } from "./list-strict";

describe("listStrictError", () => {
  it("returns null when every server answered", () => {
    expect(listStrictError("tools/list", "ns-1", [], 42)).toBeNull();
  });

  it("returns null when nothing failed and the namespace is genuinely empty", () => {
    // A namespace with no servers legitimately aggregates to zero results.
    // That is not a degraded response and must never become an error.
    expect(listStrictError("tools/list", "ns-1", [], 0)).toBeNull();
  });

  it("returns null for a partial result, even with failures", () => {
    // Partial truth beats a hard failure: the surviving servers' tools are
    // still useful, so a caller that asked for strictness must NOT get an
    // error here.
    expect(listStrictError("tools/list", "ns-1", ["server-a"], 7)).toBeNull();
  });

  it("returns an error when the result is empty and a server failed", () => {
    const error = listStrictError("tools/list", "ns-1", ["server-a"], 0);

    expect(error).not.toBeNull();
    expect(error?.code).toBe(ErrorCode.InternalError);
    expect(error?.message).toContain("tools/list");
    expect(error?.message).toContain("ns-1");
    expect(error?.message).toContain("server-a");
  });

  it("names every failed server so the log identifies the culprits", () => {
    const error = listStrictError(
      "tools/list",
      "ns-1",
      ["server-a", "server-b", "server-c"],
      0,
    );

    expect(error?.message).toContain("all 3 backend server(s) failed");
    expect(error?.message).toContain("server-a, server-b, server-c");
  });

  it("reports the method it was called for", () => {
    // The same helper guards tools/prompts/resources/templates; the error must
    // say which one failed rather than always claiming tools/list.
    const error = listStrictError("resources/list", "ns-2", ["server-a"], 0);

    expect(error?.message).toContain("resources/list");
    expect(error?.message).not.toContain("tools/list");
  });
});
