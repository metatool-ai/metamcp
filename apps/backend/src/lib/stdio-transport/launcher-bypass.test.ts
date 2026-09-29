import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isLauncherCommand, LauncherBypass } from "./launcher-bypass";

const TTL = 60_000;

let root: string;
let procRoot: string;
let binDir: string;
let entryPoint: string;
let workDir: string;

/** A process of the fake /proc. */
function processEntry(
  pid: number,
  options: {
    comm: string;
    ppid: number;
    argv: string[];
    env?: Record<string, string>;
    cwd?: string;
    exe?: string;
    stdio?: [string, string];
  },
) {
  const dir = path.join(procRoot, String(pid));
  fs.mkdirSync(path.join(dir, "fd"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "stat"),
    `${pid} (${options.comm}) S ${options.ppid} ${pid} ${pid} 0 -1`,
  );
  fs.writeFileSync(path.join(dir, "cmdline"), options.argv.join("\0") + "\0");
  const env = Object.entries(options.env ?? {}).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(path.join(dir, "environ"), env.join("\0") + "\0");
  fs.symlinkSync(options.cwd ?? workDir, path.join(dir, "cwd"));
  fs.symlinkSync(
    options.exe ?? path.join(binDir, "node"),
    path.join(dir, "exe"),
  );
  const [stdin, stdout] = options.stdio ?? ["socket:[11]", "socket:[12]"];
  fs.symlinkSync(stdin, path.join(dir, "fd", "0"));
  fs.symlinkSync(stdout, path.join(dir, "fd", "1"));
}

/** npm exec (100) -> sh -c (101) -> node <entry point> (102) */
function npxTree(server: Partial<Parameters<typeof processEntry>[1]> = {}) {
  processEntry(100, {
    comm: "npm exec",
    ppid: 1,
    argv: ["npm exec @modelcontextprotocol/server-memory"],
  });
  processEntry(101, {
    comm: "sh",
    ppid: 100,
    argv: ["sh", "-c", "'mcp-server-memory'"],
  });
  processEntry(102, {
    comm: "node",
    ppid: 101,
    argv: ["node", entryPoint, "--dir", "", "/data/not-created-yet"],
    env: {
      PATH: `${binDir}:/usr/bin`,
      HOME: "/home/nextjs",
      npm_config_yes: "true",
    },
    ...server,
  });
}

const npxParams = () => ({
  command: "npx",
  args: [
    "-y",
    "@modelcontextprotocol/server-memory",
    "--dir",
    "",
    "/data/not-created-yet",
  ],
  env: { MEMORY_FILE: "/data/memory.json" },
  stderr: "pipe" as const,
});

function makeBypass(enabled = true): LauncherBypass {
  return new LauncherBypass({ enabled, procRoot, ttlMs: TTL });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-bypass-"));
  procRoot = path.join(root, "proc");
  binDir = path.join(root, "bin");
  workDir = path.join(root, "work");
  entryPoint = path.join(
    root,
    "npx",
    "node_modules",
    ".bin",
    "mcp-server-memory",
  );
  for (const dir of [procRoot, binDir, workDir, path.dirname(entryPoint)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(binDir, "node"), "");
  fs.writeFileSync(entryPoint, "");
  // Unrelated processes are ignored
  processEntry(1, {
    comm: "sh",
    ppid: 0,
    argv: ["/bin/sh", "./entrypoint.sh"],
  });
  processEntry(55, {
    comm: "node (backend) x",
    ppid: 1,
    argv: ["node", "dist/index.js"],
  });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("LauncherBypass", () => {
  it("starts the program npx ran directly, with its arguments, environment and directory", () => {
    npxTree();
    const bypass = makeBypass();
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();

    bypass.record(npxParams(), 100);

    expect(bypass.directLaunchFor(npxParams())).toEqual({
      command: "node",
      args: [entryPoint, "--dir", "", "/data/not-created-yet"],
      env: {
        PATH: `${binDir}:/usr/bin`,
        HOME: "/home/nextjs",
        npm_config_yes: "true",
      },
      cwd: workDir,
      stderr: "pipe",
    });
  });

  it("finds a server started without a shell (uvx)", () => {
    const python = path.join(binDir, "python3.12");
    fs.writeFileSync(python, "");
    const venvPython = path.join(root, "venv", "bin", "python");
    fs.mkdirSync(path.dirname(venvPython), { recursive: true });
    fs.symlinkSync(python, venvPython);
    const script = path.join(root, "venv", "bin", "mcp-server-time");
    fs.writeFileSync(script, "");
    processEntry(200, {
      comm: "uv",
      ppid: 1,
      argv: ["/usr/local/bin/uv", "tool", "uvx", "mcp-server-time"],
    });
    processEntry(201, {
      comm: "python",
      ppid: 200,
      argv: [venvPython, script],
      env: { PATH: `${path.dirname(venvPython)}:/usr/bin` },
      exe: python,
    });
    const params = { command: "uvx", args: ["mcp-server-time"] };
    const bypass = makeBypass();

    bypass.record(params, 200);

    expect(bypass.directLaunchFor(params)).toMatchObject({
      command: venvPython,
      args: [script],
    });
  });

  it("only applies to npx and uvx", () => {
    expect(isLauncherCommand("npx")).toBe(true);
    expect(isLauncherCommand("/usr/local/bin/uvx")).toBe(true);
    expect(isLauncherCommand("node")).toBe(false);
    expect(isLauncherCommand("docker")).toBe(false);

    npxTree();
    const bypass = makeBypass();
    const params = { ...npxParams(), command: "node" };
    bypass.record(params, 100);
    expect(bypass.directLaunchFor(params)).toBeUndefined();
  });

  it("does nothing when disabled", () => {
    npxTree();
    const bypass = makeBypass(false);
    bypass.record(npxParams(), 100);
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();
  });

  it("ignores a server that does not use the launcher's pipes", () => {
    npxTree({ stdio: ["socket:[98]", "socket:[99]"] });
    const bypass = makeBypass();
    bypass.record(npxParams(), 100);
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();
  });

  it("ignores a command line rewritten by the program (process.title)", () => {
    fs.writeFileSync(path.join(binDir, "mcp-memory"), "");
    npxTree({ argv: ["mcp-memory"] });
    const bypass = makeBypass();
    bypass.record(npxParams(), 100);
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();
  });

  it("ignores a launcher with several children", () => {
    npxTree();
    processEntry(103, {
      comm: "node",
      ppid: 100,
      argv: ["node", "update-check.js"],
    });
    const bypass = makeBypass();
    bypass.record(npxParams(), 100);
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();
  });

  it("goes through the launcher again once the entry point is gone or the record is old", () => {
    npxTree();
    const bypass = makeBypass();
    bypass.record(npxParams(), 100);

    fs.rmSync(entryPoint);
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();

    fs.writeFileSync(entryPoint, "");
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();

    vi.useFakeTimers();
    bypass.record(npxParams(), 100);
    expect(bypass.directLaunchFor(npxParams())).toBeDefined();
    vi.setSystemTime(Date.now() + TTL + 1);
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();
  });

  it("keys records on the whole configuration", () => {
    npxTree();
    const bypass = makeBypass();
    bypass.record(npxParams(), 100);

    expect(
      bypass.directLaunchFor({
        ...npxParams(),
        env: { MEMORY_FILE: "/other.json" },
      }),
    ).toBeUndefined();
    expect(
      bypass.directLaunchFor({
        ...npxParams(),
        args: ["-y", "@modelcontextprotocol/server-memory"],
      }),
    ).toBeUndefined();

    bypass.forget(npxParams());
    expect(bypass.directLaunchFor(npxParams())).toBeUndefined();
  });
});
