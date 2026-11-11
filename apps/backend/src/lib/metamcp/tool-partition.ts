import { createHash } from "node:crypto";

export interface ToolPartition {
  index: number;
  total: number;
}

/**
 * Assigns each tool name to exactly one stable partition. Hash-based assignment
 * avoids dependence on database ordering and keeps the same tool in the same
 * endpoint across refreshes and sessions.
 */
export function isToolInPartition(
  toolName: string,
  partition: ToolPartition,
): boolean {
  const digest = createHash("sha256").update(toolName).digest();
  return digest.readUInt32BE(0) % partition.total === partition.index;
}

export type ToolPartitionParseResult =
  | { partition: undefined; error?: never }
  | { partition: ToolPartition; error?: never }
  | { partition?: never; error: string };

export function parseToolPartition(
  rawIndex: unknown,
  rawTotal: unknown,
): ToolPartitionParseResult {
  if (rawIndex === undefined && rawTotal === undefined) {
    return { partition: undefined };
  }
  if (
    typeof rawIndex !== "string" ||
    typeof rawTotal !== "string" ||
    !/^\d+$/.test(rawIndex) ||
    !/^\d+$/.test(rawTotal)
  ) {
    return {
      error:
        "Provide both toolPartition (zero-based) and toolPartitions (total count) as integers.",
    };
  }

  const index = Number(rawIndex);
  const total = Number(rawTotal);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(total) ||
    total < 2 ||
    total > 100 ||
    index < 0 ||
    index >= total
  ) {
    return {
      error:
        "toolPartitions must be between 2 and 100, and toolPartition must be between 0 and toolPartitions - 1.",
    };
  }

  return { partition: { index, total } };
}
