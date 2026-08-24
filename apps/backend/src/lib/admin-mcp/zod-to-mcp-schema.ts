import { z, type ZodType } from "zod";

export function zodToMcpInputSchema(schema: ZodType): Record<string, unknown> {
  // zod v4 ships native JSON Schema conversion, replacing the external
  // zod-to-json-schema package. Inline reused subschemas (no $ref/$defs) and
  // tolerate unrepresentable nodes (e.g. z.any(), z.date()) so the MCP tool
  // inputSchema stays a single self-contained object.
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    reused: "inline",
    unrepresentable: "any",
  }) as Record<string, unknown>;

  const { $schema: _schema, ...rest } = jsonSchema;
  return rest;
}
