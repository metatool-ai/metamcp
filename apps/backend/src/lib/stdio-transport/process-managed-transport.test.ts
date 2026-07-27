import { describe, expect, it } from "vitest";

import {
  collectDescendantPids,
  parseProcStat,
} from "./process-managed-transport";

describe("parseProcStat", () => {
  it("extracts pid and parent pid from Linux proc stat lines", () => {
    expect(
      parseProcStat("131 (uv tool uvx) S 56 131 131 0 -1 4194304"),
    ).toEqual({
      pid: 131,
      ppid: 56,
    });
  });

  it("handles process names containing closing parentheses", () => {
    expect(parseProcStat("205 (worker) child) S 131 131 131 0")).toEqual({
      pid: 205,
      ppid: 131,
    });
  });

  it("returns undefined for malformed stat lines", () => {
    expect(parseProcStat("not a proc stat")).toBeUndefined();
  });
});

describe("collectDescendantPids", () => {
  it("returns every descendant below the root pid", () => {
    expect(
      collectDescendantPids(56, [
        { pid: 1, ppid: 0 },
        { pid: 56, ppid: 1 },
        { pid: 131, ppid: 56 },
        { pid: 205, ppid: 131 },
        { pid: 209, ppid: 56 },
        { pid: 216, ppid: 209 },
        { pid: 999, ppid: 1 },
      ]),
    ).toEqual([205, 131, 216, 209]);
  });

  it("returns an empty list when the root has no children", () => {
    expect(
      collectDescendantPids(56, [
        { pid: 1, ppid: 0 },
        { pid: 56, ppid: 1 },
        { pid: 999, ppid: 1 },
      ]),
    ).toEqual([]);
  });
});
