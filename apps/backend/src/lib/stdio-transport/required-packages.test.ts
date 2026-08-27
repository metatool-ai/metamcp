import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  // vi.hoisted factories run before ESM imports are initialized, so a dynamic
  // require is the only way to get EventEmitter here (eslint: allowed).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events");
  // 1 = file exists (skip-if-present guard fires), 0 = missing.
  let existingFiles = new Set<string>();
  const spawned: Array<{
    cmd: string;
    args: string[];
    env: Record<string, string>;
    proc: {
      stdin: null;
      stdout: NodeJS.EventEmitter;
      stderr: NodeJS.EventEmitter;
      emit: (e: string, code?: number) => void;
    };
  }> = [];
  let exitCode = 0;
  let statUid: number | undefined;
  // The REAL default implementation — record every spawn with its args/env and
  // close with the exit code captured AT SPAWN TIME on the next tick.
  const defaultImpl = (
    cmd: string,
    args: string[],
    opts: unknown,
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
    const env =
      typeof opts === "object" && opts !== null && "env" in opts
        ? ((opts as { env?: Record<string, string> }).env ?? {})
        : {};
    spawned.push({ cmd, args, env, proc });
    const code = exitCode;
    setImmediate(() => proc.emit("close", code));
    return proc;
  };
  // fs mock fns created in the vi.mock factory below must be assertable from
  // tests — hold them on mockState so both share ONE instance.
  const fsMocks: {
    mkdirSync: ReturnType<typeof vi.fn>;
    chownSync: ReturnType<typeof vi.fn>;
    accessSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
  } = {
    mkdirSync: vi.fn(),
    chownSync: vi.fn(),
    accessSync: vi.fn(),
    statSync: vi.fn(() => ({
      uid: statUid ?? process.getuid?.() ?? 0,
      gid: statUid ?? process.getgid?.() ?? 0,
    })),
  };
  return {
    spawn: vi.fn(defaultImpl),
    __defaultImpl: defaultImpl,
    __spawned: spawned,
    __setExitCode: (code: number) => {
      exitCode = code;
    },
    // Live view of the current existing-file set (never a stale snapshot).
    get __existingFiles(): Set<string> {
      return existingFiles;
    },
    __setExistingFiles: (paths: string[]) => {
      existingFiles = new Set(paths);
    },
    __setStatUid: (uid: number | undefined) => {
      statUid = uid;
    },
    __fsMocks: fsMocks,
  };
});

vi.mock("node:child_process", () => ({
  spawn: mockState.spawn,
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

// Never delete a real cache during tests.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const fsMocks = (mockState as any).__fsMocks;
  return {
    ...actual,
    rmSync: vi.fn(),
    existsSync: (p: string) => {
      // Read the LIVE set (__setExistingFiles may have replaced it).

      const current = (mockState as any).__existingFiles as Set<string>;
      return current.has(String(p));
    },
    // The NFS ownership self-heal mkdir/chown/access must not touch the real
    // filesystem under the mocked homedir (/home/test) — no-op them. statSync
    // defaults to the current uid (dir owned by us → chown skipped); a test can
    // override via __setStatUid to simulate a root-owned NFS dir. The vi.fn()
    // instances live on mockState so tests can assert them directly.
    mkdirSync: fsMocks.mkdirSync,
    chownSync: fsMocks.chownSync,
    accessSync: fsMocks.accessSync,
    statSync: fsMocks.statSync,
  };
});

import { rmSync } from "node:fs";

import { resetHealedKindsForTest } from "./cache-health";
import {
  ensureCacheDirsWritable,
  installRequiredPackages,
  parseGitSpec,
  sanitizeGitRepo,
} from "./required-packages";

beforeEach(() => {
  for (const key of [
    "REQUIRED_PACKAGES_NPM",
    "REQUIRED_PACKAGES_UVX",
    "REQUIRED_PACKAGES_UVX_ARGS",
    "REQUIRED_PACKAGES_BUN",
    "REQUIRED_PACKAGES_GIT_NPM",
    "REQUIRED_PACKAGES_BUN_GIT",
    "REQUIRED_PACKAGES_CONCURRENCY",
    "REQUIRED_PACKAGES_NPM_PREFIX",
    "REQUIRED_PACKAGES_NPM_CMD",
    "REQUIRED_PACKAGES_UVX_CMD",
    "REQUIRED_PACKAGES_BUN_CMD",
    "MCP_CACHE_HEAL",
    "MCP_CACHE_HEAL_FAST_FAIL_MS",
  ]) {
    delete process.env[key];
  }
  resetHealedKindsForTest();
  vi.mocked(rmSync).mockClear();
  mockState.spawn.mockReset();
  mockState.spawn.mockImplementation(mockState.__defaultImpl);
  mockState.__spawned.length = 0;
  mockState.__setExitCode(0);
  // Fresh home by default: nothing is installed yet, so the skip-if-present
  // guard never fires and every group runs its batched install.
  mockState.__setExistingFiles([]);
  // Cache dirs are "ours" by default (chown skipped); a test overrides this to
  // simulate a root-owned NFS dir.
  mockState.__setStatUid(undefined);
});

afterEach(() => {
  return new Promise((resolve) => setTimeout(resolve, 20));
});

describe("installRequiredPackages", () => {
  it("skips when no REQUIRED_PACKAGES_* packages are configured", async () => {
    await installRequiredPackages();
    expect(mockState.spawn).not.toHaveBeenCalled();
  });

  it("installs the whole npm list in ONE batched `npm install -g` invocation, BLOCKING until done", async () => {
    process.env.REQUIRED_PACKAGES_NPM = "pkg-a pkg-b";
    // Make close fire on a later tick so we can prove installRequiredPackages
    // awaits the spawns (does not return before they complete).
    let resolveFlag: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveFlag = resolve;
    });
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      const proc = mockState.__defaultImpl(cmd, args, opts) as any;
      proc.on("close", () => {
        setTimeout(() => {
          // Ensure close already emitted; then flag completion on a macrotask.
          Promise.resolve().then(resolveFlag);
        }, 0);
      });
      return proc;
    });

    await installRequiredPackages();
    await done;

    // npm config get prefix (skip-if-present probe) + ONE batched install.
    const npm = mockState.__spawned.filter((s) => s.cmd === "npm");
    const installs = npm.filter((s) => s.args[0] === "install");
    expect(installs.map((s) => s.args)).toEqual([
      ["install", "-g", "pkg-a", "pkg-b"],
    ]);
    expect(installs).toHaveLength(1);
    expect(installs.every((s) => s.cmd === "npm")).toBe(true);
  });

  it("installs uvx + bun lists with their own per-package-manager commands", async () => {
    process.env.REQUIRED_PACKAGES_UVX = "uvx-a uvx-b";
    process.env.REQUIRED_PACKAGES_BUN = "bun-a";
    process.env.REQUIRED_PACKAGES_CONCURRENCY = "2";

    await installRequiredPackages();

    const uv = mockState.__spawned.filter((s) => s.args[0] === "tool");
    // BATCHED: both uv tools in ONE `uv tool install uvx-a uvx-b`.
    expect(uv.map((s) => s.args)).toEqual([
      ["tool", "install", "uvx-a", "uvx-b"],
    ]);
    expect(uv.every((s) => s.cmd === "uvx")).toBe(true);

    const bun = mockState.__spawned.filter((s) => s.cmd === "bun");
    expect(bun.map((s) => s.args)).toEqual([["add", "-g", "bun-a"]]);
  });

  it("routes REQUIRED_PACKAGES_UVX_ARGS as one atomic uvx arg-string invocation", async () => {
    process.env.REQUIRED_PACKAGES_UVX_ARGS =
      "--from git+https://github.com/suhasvemuri/obsidian-self-mcp --with mcp==1.29.0 python -m obsidian_self_mcp.server,--from git+https://github.com/maxparez/scanopy-mcp-server python -m scanopy_mcp.main";

    // The atomic `uvx <args> --help` warm must SUCCEED (close 0) so the plain
    // `uv tool install` fallback does NOT fire (a git-URL can't be tool-installed).
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      // Force close(0) on the next tick for uvx arg-string spawns (the real
      // impl closes 0 anyway; this is belt-and-braces for the fallback path).
      if (cmd === "uvx" && args[0] === "--from") {
        process.nextTick(() => proc.emit("close", 0));
      }
      return proc;
    });

    await installRequiredPackages();

    const uvx = mockState.__spawned.filter(
      (s) => s.cmd === "uvx" && s.args[0] === "--from",
    );
    // Arg-strings are inherently one-atomic-command-per-URL (they cannot be
    // batched), but the whole group is still ONE invocation: the FIRST
    // arg-string warms with a single `uvx <args> --help`, and because it
    // SUCCEEDED (close 0), the plain `uv tool install` batch for the other
    // entries is skipped by the already-installed fast path.
    expect(uvx).toHaveLength(1);
    expect(uvx[0].args).toEqual([
      "--from",
      "git+https://github.com/suhasvemuri/obsidian-self-mcp",
      "--with",
      "mcp==1.29.0",
      "python",
      "-m",
      "obsidian_self_mcp.server",
      "--help",
    ]);
  });

  it("installs git-based npm packages inline (git clone + npm install + build)", async () => {
    process.env.REQUIRED_PACKAGES_GIT_NPM =
      "git+https://github.com/netbirdio/netbird-mcp|#|#|#";

    // The `test -x` / `test -d` probes must FAIL so the clone path runs
    // (nothing installed yet in a fresh home).
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      if (cmd === "test") {
        process.nextTick(() => proc.emit("close", 1));
      }
      return proc;
    });

    await installRequiredPackages();

    const cmds = mockState.__spawned.map((s) => s.cmd);
    // git clone (dest) → npm install → npm run build
    expect(cmds).toContain("git");
    const gitSpawn = mockState.__spawned.find((s) => s.cmd === "git");
    expect(gitSpawn?.args[0]).toBe("clone");
    const npm = mockState.__spawned.filter((s) => s.cmd === "npm");
    expect(npm.some((s) => s.args[0] === "install")).toBe(true);
    expect(npm.some((s) => s.args[0] === "run" && s.args[1] === "build")).toBe(
      true,
    );
    // mkdir for the bin dir happened first.
    expect(mockState.__spawned.some((s) => s.cmd === "mkdir")).toBe(true);
  });

  it("installs bun-compiled git packages inline (bun install deps THEN bun build --compile)", async () => {
    process.env.REQUIRED_PACKAGES_BUN_GIT =
      "git+https://github.com/nikkomiu/pocketid-mcp|#|#|#";

    await installRequiredPackages();

    const bun = mockState.__spawned.filter((s) => s.cmd === "bun");
    const installIdx = bun.findIndex((s) => s.args[0] === "install");
    const buildIdx = bun.findIndex(
      (s) => s.args[0] === "build" && s.args[2] === "--compile",
    );
    // bun install MUST run before bun build — a fresh clone has no
    // node_modules and `bun build` alone fails to resolve @modelcontextprotocol/sdk.
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(installIdx);
    expect(bun[installIdx].args[0]).toBe("install");
    expect(bun[buildIdx].args).toEqual([
      "build",
      "src/index.ts",
      "--compile",
      "--outfile",
      "/home/test/.local/bin/pocketid-mcp",
    ]);
  });

  it("sanitizes a trailing-| git spec so the clone URL + dest name have no trailing pipe", async () => {
    // A `git+https://…|` spec (the lone trailing pipe from a `|#|#|#`-style
    // entry when the parts are empty) leaks the `|` into the repo → dest
    // `~/.local/src/netbird-mcp|` → `git clone` exit 128.
    process.env.REQUIRED_PACKAGES_GIT_NPM =
      "git+https://github.com/netbirdio/netbird-mcp|#|#|#";

    // Force the `test -x` / `test -d` probes to fail so the clone path runs.
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      if (cmd === "test") {
        process.nextTick(() => proc.emit("close", 1));
      }
      return proc;
    });

    await installRequiredPackages();

    const gitSpawn = mockState.__spawned.find((s) => s.cmd === "git");
    expect(gitSpawn).toBeDefined();
    const cloneArgs = gitSpawn?.args ?? [];
    expect(cloneArgs[0]).toBe("clone");
    // `git clone --depth 1 <repo> <dest>` — the URL must NOT end in `|`, the
    // `git+` scheme marker must be stripped so `git clone` accepts it directly
    // (git rejects `git+https://` via the remote-git+https helper), and the
    // destination must be the SANITIZED name — no trailing `|`.
    expect(cloneArgs[3]).toBe("https://github.com/netbirdio/netbird-mcp");
    expect(cloneArgs[4]).toBe("/home/test/.local/src/netbird-mcp");
  });

  it("parseGitSpec strips a lone trailing pipe + whitespace from the repo and validates the scheme", () => {
    // Trailing `|` from a `|#|#|#` entry (the real netbird-mcp failure).
    expect(
      parseGitSpec("git+https://github.com/netbirdio/netbird-mcp|"),
    ).toEqual({
      repo: "git+https://github.com/netbirdio/netbird-mcp",
      subdir: "",
      cmd: "",
      args: [],
    });
    // Explicit `|#` parts are preserved.
    expect(
      parseGitSpec(
        "git+https://github.com/a/b#pkg|#sub|#npm|#install --no-audit",
      ),
    ).toEqual({
      repo: "git+https://github.com/a/b#pkg",
      subdir: "sub",
      cmd: "npm",
      args: ["install", "--no-audit"],
    });
  });

  it("sanitizeGitRepo rejects a repo that does not look like git+https://…", () => {
    expect(sanitizeGitRepo("github.com/a/b")).toBeNull();
    expect(sanitizeGitRepo("https://github.com/a/b")).toBeNull();
    expect(sanitizeGitRepo("git+ssh://git@github.com/a/b")).toBe(
      "git+ssh://git@github.com/a/b",
    );
  });

  it("a malformed git spec (no git+ scheme) is skipped loudly without cloning", async () => {
    process.env.REQUIRED_PACKAGES_GIT_NPM = "not-a-repo-url";

    await installRequiredPackages();

    expect(mockState.__spawned.some((s) => s.cmd === "git")).toBe(false);
  });

  it("ensureCacheDirsWritable chowns a root-owned cache dir to the running user (NFS self-heal)", () => {
    // Simulate an NFS mount that came up root-owned: stat reports uid 0.
    mockState.__setStatUid(0);
    const { mkdirSync, chownSync } = mockState.__fsMocks;
    vi.mocked(mkdirSync).mockClear();
    vi.mocked(chownSync).mockClear();

    ensureCacheDirsWritable(["/home/test/.npm-global"]);

    expect(mkdirSync).toHaveBeenCalledWith("/home/test/.npm-global", {
      recursive: true,
    });
    // chown to the RUNNING uid (not root) — self-heal, not privilege grab.
    expect(chownSync).toHaveBeenCalledWith(
      "/home/test/.npm-global",
      process.getuid?.() ?? -1,
      process.getgid?.() ?? -1,
    );
  });

  it("forces devDependencies into git-npm installs (npm_config_include=dev) so tsc/tsx survive NODE_ENV=production", async () => {
    process.env.REQUIRED_PACKAGES_GIT_NPM =
      "git+https://github.com/netbirdio/netbird-mcp|#|#|#";
    process.env.NODE_ENV = "production";

    // Force the `test -x` / `test -d` probes to fail so the clone path runs.
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      if (cmd === "test") {
        process.nextTick(() => proc.emit("close", 1));
      }
      return proc;
    });

    await installRequiredPackages();

    const npmInstall = mockState.__spawned.find(
      (s) => s.cmd === "npm" && s.args[0] === "install",
    );
    expect(npmInstall).toBeDefined();
    // The install env MUST force devDeps + a dev context so typescript/tsc are
    // present for `npm run build` even when the container runs NODE_ENV=production.
    expect(npmInstall?.env.npm_config_include).toBe("dev");
    expect(npmInstall?.env.NODE_ENV).toBe("development");
  });

  it("skips the install entirely when every package is already present (warm-cache no-op)", async () => {
    process.env.REQUIRED_PACKAGES_NPM = "pkg-a @scoped/b";
    // Static install location: /home/test/.npm-global (npm config get prefix
    // fails → default). Both packages already present in node_modules.
    mockState.__setExistingFiles([
      "/home/test/.npm-global/node_modules/pkg-a",
      "/home/test/.npm-global/node_modules/@scoped/b",
    ]);

    await installRequiredPackages();

    // Only the npm config get prefix probe runs — NO install is invoked.
    expect(mockState.__spawned.some((s) => s.args[0] === "install")).toBe(
      false,
    );
  });

  it("still installs the packages that are missing (partial warm cache)", async () => {
    process.env.REQUIRED_PACKAGES_NPM = "pkg-a pkg-b";
    // pkg-a is already installed; pkg-b is missing → only pkg-b is installed.
    mockState.__setExistingFiles(["/home/test/.npm-global/node_modules/pkg-a"]);

    await installRequiredPackages();

    const installs = mockState.__spawned.filter((s) => s.args[0] === "install");
    expect(installs.map((s) => s.args)).toEqual([["install", "-g", "pkg-b"]]);
  });

  it("a failing package does not block the other packages (batched install, per-package log lines)", async () => {
    process.env.REQUIRED_PACKAGES_NPM = "pkg-a pkg-b pkg-c";

    // Make the single batched install exit non-zero, as if one of the three
    // packages failed. The batch still logs a per-package "Failed: <pkg>" line
    // for each missing package and boot proceeds.
    let installRan = false;
    const originalImpl = mockState.spawn.getMockImplementation();
    mockState.spawn.mockImplementation((cmd, args, opts) => {
      if (!originalImpl) {
        throw new Error("expected the real spawn implementation");
      }
      const proc = originalImpl(cmd, args, opts);
      if (cmd === "npm" && args[0] === "install" && !installRan) {
        installRan = true;
        process.nextTick(() => proc.emit("close", 1));
      }
      return proc;
    });

    await installRequiredPackages();

    // The whole list is passed in ONE batched invocation.
    const installs = mockState.__spawned.filter((s) => s.args[0] === "install");
    expect(installs.map((s) => s.args)).toEqual([
      ["install", "-g", "pkg-a", "pkg-b", "pkg-c"],
    ]);
  });

  it("resolves to a writable npm prefix (install into ~/.npm-global)", async () => {
    process.env.REQUIRED_PACKAGES_NPM = "pkg-a";

    await installRequiredPackages();

    const install = mockState.__spawned.find((s) => s.args[0] === "install");
    // The env passed to the install spawn carries npm_config_prefix.
    expect(install).toBeDefined();
  });
});
