import { DatabaseToolSchema, ToolUpsertInputSchema } from "@repo/zod-types";
import { describe, expect, it } from "vitest";

describe("tool schema persistence", () => {
  const extendedSchema = {
    type: "object" as const,
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
    $defs: { query: { minLength: 2 } },
    oneOf: [{ required: ["query"] }],
  };

  it("retains extended JSON Schema keywords during tool sync parsing", () => {
    const parsed = ToolUpsertInputSchema.parse({
      mcpServerUuid: "server-uuid",
      tools: [{ name: "search", inputSchema: extendedSchema }],
    });

    expect(parsed.tools[0].inputSchema).toEqual(extendedSchema);
  });

  it("retains extended JSON Schema keywords when reading persisted tools", () => {
    const parsed = DatabaseToolSchema.parse({
      uuid: "tool-uuid",
      name: "search",
      description: "Search records",
      annotations: { readOnlyHint: true },
      toolSchema: extendedSchema,
      created_at: new Date(),
      updated_at: new Date(),
      mcp_server_uuid: "server-uuid",
    });

    expect(parsed.toolSchema).toEqual(extendedSchema);
  });
});
