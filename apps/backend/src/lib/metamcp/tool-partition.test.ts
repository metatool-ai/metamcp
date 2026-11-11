import { describe, expect, it } from "vitest";

import { isToolInPartition, parseToolPartition } from "./tool-partition";

describe("isToolInPartition", () => {
  it("assigns every tool to exactly one partition", () => {
    const tools = Array.from(
      { length: 2032 },
      (_, index) => `server__tool_${index}`,
    );
    const partitions = [0, 1, 2].map((index) => ({
      index,
      total: 3,
    }));
    const assignments = tools.map((tool) =>
      partitions.filter((partition) => isToolInPartition(tool, partition)),
    );

    expect(assignments.every((matches) => matches.length === 1)).toBe(true);
    expect(
      new Set(
        tools.map(
          (tool) => partitions.find((p) => isToolInPartition(tool, p))?.index,
        ),
      ).size,
    ).toBe(3);
  });

  it("keeps a 2,032-tool namespace under the 1,000-tool connector cap across three partitions", () => {
    const tools = Array.from(
      { length: 2032 },
      (_, index) => `server__tool_${index}`,
    );
    const counts = [0, 1, 2].map(
      (index) =>
        tools.filter((tool) => isToolInPartition(tool, { index, total: 3 }))
          .length,
    );

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2032);
    expect(Math.max(...counts)).toBeLessThanOrEqual(1000);
  });

  it("is stable regardless of tool discovery order", () => {
    const partition = { index: 1, total: 3 };
    expect(isToolInPartition("server__tool_a", partition)).toBe(
      isToolInPartition("server__tool_a", partition),
    );
  });
});

describe("parseToolPartition", () => {
  it("accepts a valid zero-based partition", () => {
    expect(parseToolPartition("0", "3")).toEqual({
      partition: { index: 0, total: 3 },
    });
  });

  it("keeps unpartitioned endpoints backward compatible", () => {
    expect(parseToolPartition(undefined, undefined)).toEqual({
      partition: undefined,
    });
  });

  it.each([
    ["0", undefined],
    [undefined, "3"],
    ["x", "3"],
    ["3", "3"],
    ["0", "1"],
    ["0", "101"],
    ["-1", "3"],
    ["1.5", "3"],
    [["0"], "3"],
  ])("rejects invalid partition values %s / %s", (index, total) => {
    expect(parseToolPartition(index, total)).toHaveProperty("error");
  });
});
