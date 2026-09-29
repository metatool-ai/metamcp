import type express from "express";
import { describe, expect, it, vi } from "vitest";

import { requireInspectorRequest } from "./inspector-request.middleware";

function run(headers: Record<string, string>) {
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(),
  };
  const next = vi.fn();
  requireInspectorRequest(
    { headers } as unknown as express.Request,
    res as unknown as express.Response,
    next,
  );
  return { status: res.statusCode, passed: next.mock.calls.length === 1 };
}

describe("requireInspectorRequest", () => {
  it("accepts same-origin requests from the web app", () => {
    expect(
      run({ "x-metamcp-inspector": "1", "sec-fetch-site": "same-origin" }),
    ).toEqual({ status: 200, passed: true });
    // Browsers without Fetch Metadata: the header alone is enough
    expect(run({ "x-metamcp-inspector": "1" }).passed).toBe(true);
  });

  it("rejects a cross-site navigation carrying the session cookie", () => {
    expect(
      run({
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
        cookie: "better-auth.session_token=x",
      }),
    ).toEqual({ status: 403, passed: false });
  });

  it("rejects requests flagged cross-site even with the header", () => {
    expect(
      run({ "x-metamcp-inspector": "1", "sec-fetch-site": "same-site" }),
    ).toEqual({ status: 403, passed: false });
    expect(
      run({ "x-metamcp-inspector": "1", "sec-fetch-site": "cross-site" })
        .passed,
    ).toBe(false);
  });

  it("rejects requests without the header", () => {
    expect(run({ "sec-fetch-site": "same-origin" }).status).toBe(403);
    expect(run({ "x-metamcp-inspector": "true" }).status).toBe(403);
  });
});
