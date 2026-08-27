import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted state shared between the cross-spawn mock and the tests.
// Mocking cross-spawn (rather than node:child_process) is load-bearing: the
// transport imports `spawn from "cross-spawn"`, which does its own
// `require("child_process")` — and that module reference resolves to the real
// one before vitest's node:child_process mock can take effect in this graph.
const mockState = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("node:events");
  const spawned: Array<{ cmd: string; args: string[] }> = [];
  let exitCode = 1;
  let emitExit = true;
  const defaultImpl = (
    cmd: string,
    args: string[],
    _opts: unknown,
  ): {
    stdin: NodeJS.EventEmitter;
    stdout: NodeJS.EventEmitter;
    stderr: NodeJS.EventEmitter;
    unref: () => void;
    write: (s: string) => boolean;
    emit: (e: string, code?: number) => boolean;
  } => {
    const proc = new EventEmitter() as unknown as {
      stdin: NodeJS.EventEmitter;
      stdout: NodeJS.EventEmitter;
      stderr: NodeJS.EventEmitter;
      unref: () => void;
      write: (s: string) => boolean;
      emit: (e: string, code?: number) => boolean;
    };
    proc.stdin = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.unref = () => {};
    (proc.stdin as unknown as { write: (s: string) => boolean }).write = () =>
      true;
    spawned.push({ cmd, args });
    // Resolve start()'s "spawn" wait first.
    setImmediate(() => proc.emit("spawn"));
    // Then, if configured, emit "close" (the process died) on a later tick so
    // the transport's close handler runs before the test's send().
    if (emitExit) {
      setTimeout(() => proc.emit("close", exitCode), 1);
    }
    return proc;
  };
  return {
    spawn: vi.fn(defaultImpl),
    __spawned: spawned,
    __setExitCode: (code: number) => {
      exitCode = code;
    },
    __setEmitExit: (v: boolean) => {
      emitExit = v;
    },
  };
});

vi.mock("cross-spawn", () => ({
  default: mockState.spawn,
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/test",
}));

import { ProcessManagedStdioTransport } from "./process-managed-transport";

describe("ProcessManagedStdioTransport", () => {
  beforeEach(() => {
    mockState.__spawned.length = 0;
    mockState.__setExitCode(1);
    mockState.__setEmitExit(true);
    delete process.env.MCP_STDIO_MISSING_LAUNCHER_ABORT;
  });

  afterEach(() => {
    delete process.env.MCP_STDIO_MISSING_LAUNCHER_ABORT;
  });

  it("rejects send() with the process exit reason when the spawned process dies", async () => {
    const transport = new ProcessManagedStdioTransport({
      command: "echo",
      args: [],
    });
    // start() resolves on the mocked "spawn" event; the mocked proc then
    // emits "close" with a non-zero code on a later tick, setting _rejectError.
    await transport.start();
    // Wait for the mocked "close" emission to be processed by the transport.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      transport.send({ jsonrpc: "2.0", method: "ping", id: 1 }),
    ).rejects.toThrow("MCP server process exited unexpectedly");
  });

  it("surfaces the generic 'Not connected' marker when no process was ever spawned", async () => {
    const transport = new ProcessManagedStdioTransport({
      command: "echo",
      args: [],
    });
    // No start() — a bare transport with no process and no exit reason.
    await expect(
      transport.send({ jsonrpc: "2.0", method: "ping", id: 1 }),
    ).rejects.toThrow("Not connected");
  });

  it("refuses to start when a bare-name launcher is missing (fast-fail, not a zombie spawn)", async () => {
    process.env.MCP_STDIO_MISSING_LAUNCHER_ABORT = "1";
    // Force the PATH probe to miss by pointing PATH at an empty dir.
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-dir-for-launcher-probe";
    try {
      const transport = new ProcessManagedStdioTransport({
        command: "surely-does-not-exist-mcp-launcher",
        args: [],
      });
      await expect(transport.start()).rejects.toThrow(
        "MCP stdio launcher not found",
      );

      // No process should have been spawned at all.
      expect(mockState.__spawned.length).toBe(0);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("refuses to start when an ABSOLUTE-path launcher is missing (the production ENOENT shape)", async () => {
    process.env.MCP_STDIO_MISSING_LAUNCHER_ABORT = "1";
    const transport = new ProcessManagedStdioTransport({
      command: "/home/nextjs/.local/bin/mcp-assistant",
      args: [],
    });
    await expect(transport.start()).rejects.toThrow(
      "MCP stdio launcher not found (/home/nextjs/.local/bin/mcp-assistant)",
    );

    // No process should have been spawned at all.
    expect(mockState.__spawned.length).toBe(0);
  });

  it("allows a missing launcher when MCP_STDIO_MISSING_LAUNCHER_ABORT=0 (boot-path test)", async () => {
    process.env.MCP_STDIO_MISSING_LAUNCHER_ABORT = "0";
    const transport = new ProcessManagedStdioTransport({
      command: "surely-does-not-exist-mcp-launcher",
      args: [],
    });
    // start() proceeds to spawn; the mocked cross-spawn emits "spawn" and
    // resolves. The process "exits" on a later tick — that is the async-ENOENT
    // path, which is allowed when abort is disabled.
    await expect(transport.start()).resolves.toBeUndefined();
    expect(mockState.__spawned.length).toBe(1);
  });
});
