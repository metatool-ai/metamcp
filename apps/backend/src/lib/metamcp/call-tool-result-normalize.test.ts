import {
  CallToolResult,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { normalizeCallToolResult } from "./call-tool-result";

describe("normalizeCallToolResult", () => {
  it("passes a well-formed CallToolResult through unchanged", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "hello" }],
    };
    expect(normalizeCallToolResult(result, "server-1")).toBe(result);
  });

  it("coerces a non-conforming content block instead of hard-failing (-32602)", () => {
    // The pocket-id case: content[0] is missing type/text.
    const result = {
      content: [{ foo: "bar" }],
    } as unknown as CallToolResult;

    const normalized = normalizeCallToolResult(result, "server-1");
    expect(normalized.content).toHaveLength(1);
    expect(normalized.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify({ foo: "bar" }),
    });
  });

  it("coerces a bare string content block to a text block", () => {
    const result = {
      content: ["just a string"],
    } as unknown as CallToolResult;

    const normalized = normalizeCallToolResult(result, "server-1");
    expect(normalized.content[0]).toMatchObject({
      type: "text",
      text: "just a string",
    });
  });

  it("coerces non-array content to a single text block", () => {
    const result = {
      content: { message: "hello" },
    } as unknown as CallToolResult;

    const normalized = normalizeCallToolResult(result, "server-1");
    expect(normalized.content).toHaveLength(1);
    expect(normalized.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify({ message: "hello" }),
    });
  });

  it("preserves conforming blocks and only coerces the malformed ones", () => {
    const result = {
      content: [
        { type: "text", text: "ok" },
        { type: "image", data: "abc", mimeType: "image/png" },
        { missing: true },
      ],
    } as unknown as CallToolResult;

    const normalized = normalizeCallToolResult(result, "server-1");
    expect(normalized.content).toHaveLength(3);
    expect(normalized.content[0]).toMatchObject({ type: "text", text: "ok" });
    expect(normalized.content[1]).toMatchObject({ type: "image" });
    expect(normalized.content[2]).toMatchObject({
      type: "text",
      text: JSON.stringify({ missing: true }),
    });
  });

  it("returns a valid empty result when content is undefined", () => {
    const result = { content: undefined } as unknown as CallToolResult;
    const normalized = normalizeCallToolResult(result, "server-1");
    expect(normalized.content).toHaveLength(1);
    expect(normalized.content[0]).toMatchObject({ type: "text", text: "" });
  });

  it("the normalized result passes CallToolResultSchema (no -32602 after normalization)", () => {
    // The pocket-id case: content[0] is { foo: "bar" } — a raw backend result
    // that hard-fails the SDK schema with -32602 if not normalized first.
    const raw = {
      content: [{ foo: "bar" }],
    } as unknown as CallToolResult;

    const normalized = normalizeCallToolResult(raw, "server-1");
    // This is the exact check the proxy now runs after normalizing; a raw
    // backend result would have failed here.
    expect(CallToolResultSchema.safeParse(normalized).success).toBe(true);
  });
});
