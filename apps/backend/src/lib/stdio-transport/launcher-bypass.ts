import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import logger from "@/utils/logger";

import type { StdioServerParameters } from "./process-managed-transport";

/**
 * npx and uvx stay alive next to the server they start: npm exec holds
 * 80-120 MB and uv 60-75 MB per connection, and each start pays for their
 * package resolution (1-10 s). Once a server started through one of them,
 * the program they ran is read from /proc; later connections start that
 * program directly, with the same arguments, environment and working
 * directory. A start through the launcher every `ttlMs` picks up package
 * updates.
 *
 * Linux only (/proc). Disabled with MCP_LAUNCHER_BYPASS=false.
 */

const LAUNCHERS = new Set(["npx", "uvx"]);
const SHELLS = new Set(["sh", "bash", "dash"]);

export interface DirectLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  recordedAt: number;
}

export interface LauncherBypassOptions {
  enabled: boolean;
  procRoot: string;
  ttlMs: number;
}

export function isLauncherCommand(command: string): boolean {
  return LAUNCHERS.has(path.basename(command));
}

/** Identifies a launch: the same command, arguments, environment and cwd. */
function launchKey(params: StdioServerParameters): string {
  const env = Object.entries(params.env ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return createHash("sha256")
    .update(
      JSON.stringify([params.command, params.args ?? [], env, params.cwd]),
    )
    .digest("hex");
}

/** A NUL-separated /proc list (cmdline, environ); empty items are kept. */
function readNulList(file: string): string[] {
  const items = fs.readFileSync(file, "utf8").split("\0");
  if (items[items.length - 1] === "") {
    items.pop();
  }
  return items;
}

/** An executable named like a shell would find it. */
function resolveExecutable(
  command: string,
  pathVariable: string | undefined,
  cwd: string,
): string | undefined {
  const isFile = (candidate: string) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes("/")) {
    const candidate = path.resolve(cwd, command);
    return isFile(candidate) ? candidate : undefined;
  }
  for (const dir of (pathVariable ?? "").split(":")) {
    if (!dir) continue;
    const candidate = path.resolve(cwd, dir, command);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

export class LauncherBypass {
  private readonly records = new Map<string, DirectLaunch>();

  constructor(private readonly options: LauncherBypassOptions) {}

  /**
   * The program to start instead of `params` when it goes through a launcher
   * that already ran it recently and the program is still installed.
   */
  directLaunchFor(
    params: StdioServerParameters,
  ): StdioServerParameters | undefined {
    if (!this.options.enabled || !isLauncherCommand(params.command)) {
      return undefined;
    }
    const key = launchKey(params);
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }
    if (
      Date.now() - record.recordedAt > this.options.ttlMs ||
      !this.stillInstalled(record, params.args ?? [])
    ) {
      this.records.delete(key);
      return undefined;
    }
    return {
      ...params,
      command: record.command,
      args: record.args,
      env: record.env,
      cwd: record.cwd,
    };
  }

  /** Drops what was recorded for `params` (it did not start as recorded). */
  forget(params: StdioServerParameters): void {
    this.records.delete(launchKey(params));
  }

  /**
   * Records the program a launcher started, once the server answered: the
   * launcher's process `launcherPid` must have started it with the pipes
   * MetaMCP gave the launcher, so that starting it directly is equivalent.
   */
  record(params: StdioServerParameters, launcherPid: number | null): void {
    if (
      !this.options.enabled ||
      !launcherPid ||
      !isLauncherCommand(params.command)
    ) {
      return;
    }

    try {
      const serverPid = this.findServerProcess(launcherPid);
      if (!serverPid) {
        logger.debug(
          `Launcher bypass: no server process found under ${params.command} (PID ${launcherPid})`,
        );
        return;
      }

      const proc = path.join(this.options.procRoot, String(serverPid));
      const argv = readNulList(path.join(proc, "cmdline"));
      const env: Record<string, string> = {};
      for (const entry of readNulList(path.join(proc, "environ"))) {
        const separator = entry.indexOf("=");
        if (separator > 0) {
          env[entry.slice(0, separator)] = entry.slice(separator + 1);
        }
      }
      const cwd = fs.readlinkSync(path.join(proc, "cwd"));

      // A program can rewrite its command line (process.title): replay it
      // only when it still names the executable that runs.
      const executable = argv[0]
        ? resolveExecutable(argv[0], env.PATH, cwd)
        : undefined;
      if (
        !executable ||
        fs.realpathSync(executable) !== fs.realpathSync(path.join(proc, "exe"))
      ) {
        logger.debug(
          `Launcher bypass: the command line of PID ${serverPid} does not name its executable`,
        );
        return;
      }

      this.records.set(launchKey(params), {
        command: argv[0],
        args: argv.slice(1),
        env,
        cwd,
        recordedAt: Date.now(),
      });
      logger.info(
        `Launcher bypass: next starts of "${params.command} ${(params.args ?? []).join(" ")}" run ${argv[0]} directly`,
      );
    } catch (error) {
      logger.debug("Launcher bypass: could not record the launch:", error);
    }
  }

  private findServerProcess(launcherPid: number): number | undefined {
    const stdin = this.fd(launcherPid, 0);
    const stdout = this.fd(launcherPid, 1);
    if (!stdin || !stdout) {
      return undefined;
    }

    // launcher -> [sh -c ...] -> server
    let pid = launcherPid;
    for (let depth = 0; depth < 4; depth++) {
      const children = this.childrenOf(pid);
      if (children.length !== 1) {
        return undefined;
      }
      pid = children[0];
      const argv = readNulList(
        path.join(this.options.procRoot, String(pid), "cmdline"),
      );
      const isShell =
        argv.length >= 2 &&
        SHELLS.has(path.basename(argv[0])) &&
        argv[1] === "-c";
      if (!isShell) {
        // It must talk over MetaMCP's pipes, not through the launcher
        return this.fd(pid, 0) === stdin && this.fd(pid, 1) === stdout
          ? pid
          : undefined;
      }
    }
    return undefined;
  }

  private childrenOf(parentPid: number): number[] {
    const children: number[] = [];
    for (const entry of fs.readdirSync(this.options.procRoot)) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        // "pid (comm) state ppid ...": comm may contain spaces and parentheses
        const stat = fs.readFileSync(
          path.join(this.options.procRoot, entry, "stat"),
          "utf8",
        );
        const ppid = Number(
          stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1],
        );
        if (ppid === parentPid) {
          children.push(Number(entry));
        }
      } catch {
        // The process exited meanwhile
      }
    }
    return children;
  }

  private fd(pid: number, fd: number): string | undefined {
    try {
      return fs.readlinkSync(
        path.join(this.options.procRoot, String(pid), "fd", String(fd)),
      );
    } catch {
      return undefined;
    }
  }

  /**
   * The program and the files the launcher added to its command line (the
   * package's entry point) are still there: a cache clean-up removes them.
   */
  private stillInstalled(
    record: DirectLaunch,
    configuredArgs: string[],
  ): boolean {
    if (!resolveExecutable(record.command, record.env.PATH, record.cwd)) {
      return false;
    }
    return record.args
      .filter((arg) => path.isAbsolute(arg) && !configuredArgs.includes(arg))
      .every((arg) => fs.existsSync(arg));
  }
}

export const launcherBypass = new LauncherBypass({
  enabled:
    process.platform === "linux" &&
    process.env.MCP_LAUNCHER_BYPASS !== "false" &&
    fs.existsSync("/proc/self"),
  procRoot: "/proc",
  ttlMs: 24 * 60 * 60 * 1000,
});
