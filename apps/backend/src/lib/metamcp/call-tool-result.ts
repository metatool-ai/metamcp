import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import logger from "@/utils/logger";

/**
 * True if a content block is already a valid SDK content block. Accepts any of
 * the SDK's known block shapes (text has `text`, image has `data`+`mimeType`,
 * resource has `resource`, audio has `data`+`mimeType`); a block that is not an
 * object with a string `type` and its type's required fields is malformed.
 */
function isConformingContentBlock(
  block: CallToolResult["content"][number] | null | undefined | object | string,
): block is CallToolResult["content"][number] {
  if (typeof block !== "object" || block === null) {
    return false;
  }
  const b = block as Record<string, unknown>;
  if (typeof b.type !== "string") {
    return false;
  }
  switch (b.type) {
    case "text":
      return typeof b.text === "string";
    case "image":
    case "audio":
      return typeof b.data === "string" && typeof b.mimeType === "string";
    case "resource":
      return typeof b.resource === "object" && b.resource !== null;
    default:
      // Unknown block type — treat as malformed and coerce to text.
      return false;
  }
}

/**
 * Coerce a backend's `CallToolResult` into the SDK shape the MCP client
 * expects. Some backends return a non-conforming `content` (e.g.
 * `[{ foo: "bar" }]` without `type`/`text`, or a bare string) which would
 * otherwise hard-fail the zod validation with `-32602`. A backend's malformed
 * output must never become a client-facing error — we normalize it instead and
 * log the malformed shape for the operator.
 */
export function normalizeCallToolResult(
  result: CallToolResult,
  serverUuid: string,
): CallToolResult {
  const content = result.content;

  if (!Array.isArray(content)) {
    if (content !== undefined && content !== null) {
      logger.warn(
        `[call-tool] backend ${serverUuid} returned non-array CallToolResult content; coercing to text (${typeof content})`,
      );
    }
    return {
      ...result,
      content: [
        {
          type: "text",
          text:
            content === undefined || content === null
              ? ""
              : typeof content === "string"
                ? content
                : JSON.stringify(content),
        },
      ],
    };
  }

  const needsCoercion = content.some((block) => !isConformingContentBlock(block));

  if (!needsCoercion) {
    return result;
  }

  logger.warn(
    `[call-tool] backend ${serverUuid} returned malformed CallToolResult content; coercing non-conforming blocks to text`,
  );

  return {
    ...result,
    content: content.map((block) => {
      const unknownBlock = block as Record<string, unknown> | null;
      if (isConformingContentBlock(block)) {
        return block;
      }
      // Coerce a non-conforming block to a text block. Preserve known fields
      // when available; a bare string becomes its own text block.
      if (typeof block === "string") {
        return { type: "text", text: block };
      }
      const text =
        unknownBlock === null
          ? ""
          : typeof unknownBlock?.text === "string"
            ? unknownBlock.text
            : JSON.stringify(unknownBlock);
      return { type: "text", text };
    }),
  };
}
