import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  // vi.hoisted factories run before ESM imports are initialized, so a dynamic
  // require is the only way to get EventEmitter here (eslint: allowed).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events");
  const spawned: Array<{ cmd: string; args: string[] }> = [];
  let exitCode = 0;
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
    spawned.push({ cmd, args });
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

// Capture rmSync calls instead of actually deleting anything (partial mock:
// the logger still needs the rest of node:fs, e.g. createWriteStream).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync: vi.fn(),
  };
});

import { rmSync } from "node:fs";

import {
  cacheDirFor,
  cacheKindForCommand,
  maybeHealOnFastCrash,
  resetHealedKindsForTest,
  verifyAndHealNpmCache,
} from "./cache-health";

beforeEach(() => {
  delete process.env.MCP_CACHE_HEAL;
  delete process.env.MCP_CACHE_HEAL_FAST_FAIL_MS;
  delete process.env.npm_config_cache;
  delete process.env.UV_CACHE_DIR;
  resetHealedKindsForTest();
  mockState.spawn.mockClear();
  mockState.spawn.mockImplementation(mockState.__defaultImpl);
  mockState.__spawned.length = 0;
  mockState.__setExitCode(0);
  vi.mocked(rmSync).mockClear();
});

afterEach(() => {
  return new Promise((resolve) => setTimeout(resolve, 20));
});

describe("cacheKindForCommand", () => {
  it("classifies npx and npm as npm", () => {
    expect(
      cacheKindForCommand("npx -y @modelcontextprotocol/server-github"),
    ).toBe("npm");
    expect(cacheKindForCommand("npm exec --yes mcp-server-immich")).toBe("npm");
  });

  it("classifies uvx as uv", () => {
    expect(cacheKindForCommand("uvx mcpo")).toBe("uv");
  });

  it("classifies bunx and bun as bun", () => {
    expect(cacheKindForCommand("bunx @cyanheads/nws-weather-mcp-server")).toBe(
      "bun",
    );
    expect(cacheKindForCommand("bun ./server.js")).toBe("bun");
  });

  it("returns undefined for unknown commands", () => {
    expect(
      cacheKindForCommand("/opt/pocket-id/pocket-id serve"),
    ).toBeUndefined();
    expect(cacheKindForCommand(undefined)).toBeUndefined();
  });
});

describe("verifyAndHealNpmCache", () => {
  it("does nothing when MCP_CACHE_HEAL is off", async () => {
    mockState.__setExitCode(1);
    expect(await verifyAndHealNpmCache()).toBe(false);
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });

  it("does nothing on a clean verify", async () => {
    process.env.MCP_CACHE_HEAL = "1";
    mockState.__setExitCode(0);
    expect(await verifyAndHealNpmCache()).toBe(false);
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
    expect(mockState.__spawned[0]?.cmd).toBe("npm");
    expect(mockState.__spawned[0]?.args).toEqual(["cache", "verify"]);
  });

  it("purges the npm cache when verify fails", async () => {
    process.env.MCP_CACHE_HEAL = "1";
    mockState.__setExitCode(1);
    expect(await verifyAndHealNpmCache()).toBe(true);
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(
      expect.stringContaining(".npm"),
      { recursive: true, force: true },
    );
  });
});

describe("maybeHealOnFastCrash", () => {
  it("does nothing when MCP_CACHE_HEAL is off", () => {
    expect(maybeHealOnFastCrash("npx -y foo", 1, 100)).toBe(false);
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });

  it("heals the npm cache on a fast non-zero exit", () => {
    process.env.MCP_CACHE_HEAL = "1";
    expect(
      maybeHealOnFastCrash(
        "npx -y @modelcontextprotocol/server-github",
        1,
        500,
      ),
    ).toBe(true);
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(
      expect.stringContaining(".npm"),
      { recursive: true, force: true },
    );
  });

  it("heals the uv cache for uvx", () => {
    process.env.MCP_CACHE_HEAL = "1";
    expect(maybeHealOnFastCrash("uvx mcpo", 1, 500)).toBe(true);
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(
      expect.stringContaining("uv"),
      { recursive: true, force: true },
    );
  });

  it("ignores exit 0, signal null, slow crashes, and unknown commands", () => {
    process.env.MCP_CACHE_HEAL = "1";
    expect(maybeHealOnFastCrash("npx -y foo", 0, 500)).toBe(false);
    expect(maybeHealOnFastCrash("npx -y foo", null, 500)).toBe(false);
    expect(maybeHealOnFastCrash("npx -y foo", 1, 60_000)).toBe(false);
    expect(maybeHealOnFastCrash("/opt/pocket-id/pocket-id serve", 1, 100)).toBe(
      false,
    );
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });

  it("heals a given cache kind only once per process lifetime", () => {
    process.env.MCP_CACHE_HEAL = "1";
    expect(maybeHealOnFastCrash("npx -y foo", 1, 100)).toBe(true);
    expect(maybeHealOnFastCrash("npx -y foo", 1, 100)).toBe(false);
    expect(maybeHealOnFastCrash("npm exec foo", 1, 100)).toBe(false);
    expect(maybeHealOnFastCrash("uvx foo", 1, 100)).toBe(true);
    expect(vi.mocked(rmSync)).toHaveBeenCalledTimes(2);
  });

  it("respects the fast-fail window override", () => {
    process.env.MCP_CACHE_HEAL = "1";
    process.env.MCP_CACHE_HEAL_FAST_FAIL_MS = "2000";
    expect(maybeHealOnFastCrash("npx -y foo", 1, 1500)).toBe(true);
    resetHealedKindsForTest();
    expect(maybeHealOnFastCrash("npx -y foo", 1, 2500)).toBe(false);
  });

  it("resolves cache dirs from npm_config_cache and UV_CACHE_DIR", () => {
    process.env.npm_config_cache = "/custom/npm-cache";
    process.env.UV_CACHE_DIR = "/custom/uv-cache";
    expect(cacheDirFor("npm")).toBe("/custom/npm-cache");
    expect(cacheDirFor("uv")).toBe("/custom/uv-cache");
    expect(cacheDirFor("bun")).toBe("/home/test/.bun");
  });
});
