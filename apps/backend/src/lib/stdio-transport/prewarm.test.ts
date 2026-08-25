import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  // vi.hoisted factories run before ESM imports are initialized, so a dynamic
  // require is the only way to get EventEmitter here (eslint: allowed).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events");
  const spawned: Array<{
    cmd: string;
    args: string[];
    proc: {
      stdin: null;
      stdout: NodeJS.EventEmitter;
      stderr: NodeJS.EventEmitter;
      emit: (e: string, code?: number) => void;
    };
  }> = [];
  let exitCode = 0;
  // The REAL default implementation — record every spawn with its args and
  // close with the exit code captured AT SPAWN TIME on the next tick. Tests
  // that swap in a custom mockImplementation restore this in `beforeEach`.
  const defaultImpl = (
    cmd: string,
    args: string[],
    _opts: unknown,
  ): {
    stdin: null;
    stdout: NodeJS.EventEmitter;
    stderr: NodeJS.EventEmitter;
    emit: (e: string, code?: number) => void;
  } => {
    const proc = new EventEmitter() as {
      stdin: null;
      stdout: NodeJS.EventEmitter;
      stderr: NodeJS.EventEmitter;
      emit: (e: string, code?: number) => void;
    };
    proc.stdin = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    spawned.push({ cmd, args, proc });
    const code = exitCode;
    setImmediate(() => proc.emit("close", code));
    return proc;
  };
  return {
    spawn: vi.fn(defaultImpl),
    __defaultImpl: defaultImpl,
    __spawned: spawned,
    __setExitCode: (code: number) => {
      exitCode = code;
    },
  };
});

vi.mock("node:child_process", () => ({
  spawn: mockState.spawn,
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

// Never delete a real cache during tests (partial mock: the logger still
// needs the rest of node:fs, e.g. createWriteStream).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync: vi.fn(),
  };
});

import { rmSync } from "node:fs";

import { resetHealedKindsForTest } from "./cache-health";
import { startRuntimePrewarm } from "./prewarm";

beforeEach(() => {
  delete process.env.MCP_PREWARM_NPM;
  delete process.env.MCP_PREWARM_UVX;
  delete process.env.MCP_PREWARM_BUN;
  delete process.env.MCP_PREWARM_CONCURRENCY;
  delete process.env.MCP_PREWARM_NPM_CMD;
  delete process.env.MCP_PREWARM_UVX_CMD;
  delete process.env.MCP_PREWARM_BUN_CMD;
  delete process.env.MCP_CACHE_HEAL;
  delete process.env.MCP_CACHE_HEAL_FAST_FAIL_MS;
  resetHealedKindsForTest();
  vi.mocked(rmSync).mockClear();
  // mockReset (not just mockClear) also drops any unconsumed
  // mockImplementationOnce queue from a prior test, then restore the real
  // implementation — a custom mockImplementation must not leak here.
  mockState.spawn.mockReset();
  mockState.spawn.mockImplementation(mockState.__defaultImpl);
  mockState.__spawned.length = 0;
  mockState.__setExitCode(0);
});

afterEach(() => {
  return new Promise((resolve) => setTimeout(resolve, 20));
});

describe("startRuntimePrewarm", () => {
  it("skips when no MCP_PREWARM_* packages are configured", () => {
    startRuntimePrewarm();
    expect(mockState.spawn).not.toHaveBeenCalled();
  });

  it("installs configured npm packages one at a time", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a pkg-b";
    startRuntimePrewarm();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const installs = mockState.__spawned.filter((s) => s.args[0] === "install");
    // One spawn per package (not a single batch) so one bad package can't
    // abort the whole list (npm 10 exits 243 on a single engine violation).
    expect(installs.map((s) => s.args)).toEqual([
      ["install", "-g", "pkg-a"],
      ["install", "-g", "pkg-b"],
    ]);
    expect(installs.every((s) => s.cmd === "npm")).toBe(true);
  });

  it("honors the custom command env (MCP_PREWARM_NPM_CMD)", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a";
    process.env.MCP_PREWARM_NPM_CMD = "/usr/local/bin/my-npm";
    startRuntimePrewarm();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const npmSpawn = mockState.__spawned.find((s) => s.args[0] === "install");
    expect(npmSpawn?.cmd).toBe("/usr/local/bin/my-npm");
  });

  it("a failing package does not block the other packages (per-package isolation)", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a pkg-b pkg-c";

    // pkg-b fails (close 1); the real impl closes 0 for the others.
    let failNext = false;
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      if (args[2] === "pkg-b") {
        failNext = true;
      }
      if (failNext) {
        failNext = false;
        process.nextTick(() => proc.emit("close", 1));
      }
      return proc;
    });

    startRuntimePrewarm();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // All three packages were attempted despite pkg-b failing.
    const installs = mockState.__spawned.filter((s) => s.args[0] === "install");
    expect(installs.map((s) => s.args[2])).toEqual(["pkg-a", "pkg-b", "pkg-c"]);
    // The failing pkg-b was attempted exactly once (no whole-group retry
    // without MCP_CACHE_HEAL).
    expect(installs.filter((s) => s.args[2] === "pkg-b").length).toBe(1);
  });

  it("does not exceed MCP_PREWARM_CONCURRENCY concurrent spawns", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a";
    process.env.MCP_PREWARM_UVX = "uvx-a";
    process.env.MCP_PREWARM_BUN = "bun-a";
    process.env.MCP_PREWARM_CONCURRENCY = "2";

    // Block ALL workers: replace the mock so every spawned process never
    // emits `close`, so no worker finishes while we observe concurrency.
    mockState.spawn.mockImplementation(() => {
      // Same `require` caveat as the hoisted factory.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const EventEmitter = require("node:events").EventEmitter;
      const emitter = new EventEmitter() as {
        stdin: null;
        stdout: NodeJS.EventEmitter;
        stderr: NodeJS.EventEmitter;
        emit: (e: string, code?: number) => void;
      };
      emitter.stdin = null;
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      // Push to __spawned so we count the attempts, but never emit close.
      mockState.__spawned.push({ cmd: "blocked", args: [], proc: emitter });
      return emitter;
    });

    startRuntimePrewarm();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 3 configured groups, concurrency 2 → at most 2 spawns fire.
    expect(mockState.__spawned.length).toBeLessThanOrEqual(2);
  });

  it("continues when an installer fails (does not throw)", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a";
    process.env.MCP_PREWARM_UVX = "uvx-a";
    process.env.MCP_PREWARM_CONCURRENCY = "1";

    // The real mock pushes every spawn with its args and emits close with the
    // exit code on the next tick. Make the FIRST spawned group (npm) fail by
    // emitting close(1) on process.nextTick — which fires BEFORE the real
    // impl's setImmediate close(0), so `run` deterministically resolves 1.
    let first = true;
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      if (first) {
        first = false;
        process.nextTick(() => proc.emit("close", 1));
      }
      return proc;
    });

    startRuntimePrewarm();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Both groups attempted despite the first failing (npm install + uvx tool).
    expect(mockState.__spawned.some((s) => s.args[0] === "install")).toBe(true);
    expect(mockState.__spawned.some((s) => s.args[0] === "tool")).toBe(true);
  });

  it("with MCP_CACHE_HEAL: purges the cache and retries once when the npm install fails", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a";
    process.env.MCP_CACHE_HEAL = "1";

    // Spawn sequence: (1) `npm cache verify` clean → no preemptive purge;
    // (2) `npm install -g pkg-a` FAILS → group retry heals the cache;
    // (3) retry install SUCCEEDS against the fresh store (default impl).
    mockState.spawn.mockImplementationOnce(() => {
      const proc = mockState.__defaultImpl("npm", ["cache", "verify"], {});
      return proc;
    });
    mockState.spawn.mockImplementationOnce(() => {
      const proc = mockState.__defaultImpl(
        "npm",
        ["install", "-g", "pkg-a"],
        {},
      );
      // First install fails.
      process.nextTick(() => proc.emit("close", 1));
      return proc;
    });

    startRuntimePrewarm();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const installs = mockState.__spawned.filter(
      (s) => s.cmd === "npm" && s.args[0] === "install",
    );
    // The retry happened (2 install spawns total).
    expect(installs.length).toBe(2);
    // The corrupt cache was purged exactly once between the two installs.
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(
      expect.stringContaining(".npm"),
      { recursive: true, force: true },
    );
  });

  it("without MCP_CACHE_HEAL: a failed install is NOT retried and the cache is not purged", async () => {
    process.env.MCP_PREWARM_NPM = "pkg-a";

    mockState.spawn.mockImplementationOnce(() => {
      const proc = mockState.__defaultImpl(
        "npm",
        ["install", "-g", "pkg-a"],
        {},
      );
      process.nextTick(() => proc.emit("close", 1));
      return proc;
    });

    startRuntimePrewarm();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const installs = mockState.__spawned.filter(
      (s) => s.cmd === "npm" && s.args[0] === "install",
    );
    expect(installs.length).toBe(1);
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });
});
