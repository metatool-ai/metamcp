import { ChildProcess, IOType } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PassThrough, Stream } from "node:stream";

import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import spawn from "cross-spawn";

import logger from "@/utils/logger";

import { maybeHealOnFastCrash } from "./cache-health";
import { ReadBuffer, serializeMessage } from "./shared";

export type StdioServerParameters = {
  /**
   * The executable to run to start the server.
   */
  command: string;

  /**
   * Command line arguments to pass to the executable.
   */
  args?: string[];

  /**
   * The environment to use when spawning the process.
   *
   * If not specified, the result of getDefaultEnvironment() will be used.
   */
  env?: Record<string, string>;

  /**
   * How to handle stderr of the child process. This matches the semantics of Node's `child_process.spawn`.
   *
   * The default is "inherit", meaning messages to stderr will be printed to the parent process's stderr.
   */
  stderr?: IOType | Stream | number;

  /**
   * The working directory to use when spawning the process.
   *
   * If not specified, the current working directory will be inherited.
   */
  cwd?: string;
};

/**
 * Environment variables to inherit by default, if an environment is not explicitly given.
 */
export const DEFAULT_INHERITED_ENV_VARS =
  process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
        "PROGRAMFILES",
      ]
    : /* list inspired by the default env inheritance of sudo */
      [
        "HOME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TERM",
        "USER",
        // SSL/Certificate variables for corporate proxies and custom CA certificates
        "NODE_EXTRA_CA_CERTS",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "SSL_CERT_FILE",
        "CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "REQUESTS_CERT_FILE",
        "CURL_CA_BUNDLE",
        "PIP_CERT",
        "UV_CERT",
        "PYTHONHTTPSVERIFY",
        // Proxy variables
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ];

/**
 * Returns a default environment object including only environment variables deemed safe to inherit.
 */
export function getDefaultEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined) {
      continue;
    }

    if (value.startsWith("()")) {
      // Skip functions, which are a security risk.
      continue;
    }

    env[key] = value;
  }

  // Always append the runtime's own bin dirs to PATH so tools installed at
  // the system level (bun/bunx, global npx packages) resolve for spawned
  // servers. In the Docker image the runtime runs as `USER nextjs`, whose
  // non-login shells do not read ~/.bashrc, so a $HOME-based install would
  // be unreachable by spawned processes — the image installs bun under
  // /usr/local precisely so this appending finds it.
  const inheritedPath = env["PATH"] ?? process.env.PATH ?? "";
  const ownBinDir = process.execPath.replace(/\/[^/]+$/, "");
  const extraDirs = ["/usr/local/bin", "/usr/bin", "/bin", ownBinDir];
  env["PATH"] = [...new Set([...extraDirs, ...inheritedPath.split(":")])]
    .filter(Boolean)
    .join(":");

  // Point `npm exec` / `npx -y` spawns at the same user-writable prefix the
  // required-packages install phase (required-packages.ts) installs into.
  // Without this, every npm MCP spawn re-resolves against the image default
  // prefix (usually /usr, which is not where the install wrote) and
  // re-installs the package into its own ~/.npm/_npx/<hash> cache — 20+ copies
  // of the same dependency tree, each holding 130-200MB RSS. With the prefix
  // pinned to the global install, `npm exec -y <pkg>` finds the already-
  // installed package and skips the download entirely (rule: packages are
  // installed once, then reused).
  if (env["npm_config_prefix"] === undefined) {
    const warmPrefix =
      process.env.REQUIRED_PACKAGES_NPM_PREFIX || `${homedir()}/.npm-global`;
    env["npm_config_prefix"] = warmPrefix;
  }

  return env;
}

/**
 * Best-effort "does this launcher exist and is it executable" probe used by the
 * fail-fast guard in start().
 *
 * - A command containing a path separator is checked directly (absolute or
 *   relative path — this is the case that matters in production: a git-built
 *   server whose launcher was never installed, e.g. /home/nextjs/.local/bin/
 *   mcp-assistant, where `spawn` would otherwise surface ENOENT asynchronously).
 * - A bare name is resolved through PATH the same way `cross-spawn` does, so
 *   `npx`, `uvx`, `bun` etc. are found even though they are not files in the
 *   container.
 *
 * Returns true when the command is definitely runnable, false when it is
 * definitely not. A command we cannot resolve is reported as missing so the
 * caller fails fast instead of spawning a process that dies in seconds.
 */
export function commandIsExecutable(command: string): boolean {
  if (command.includes("/")) {
    try {
      accessSync(command, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return true;
    } catch {
      // Try the next PATH entry.
    }
  }
  return false;
}

/**
 * Client transport for stdio: this will connect to a server by spawning a process and communicating with it over stdin/stdout.
 *
 * This transport is only available in Node.js environments.
 */
export class ProcessManagedStdioTransport implements Transport {
  private _process?: ChildProcess;
  private _abortController: AbortController = new AbortController();
  private _readBuffer: ReadBuffer = new ReadBuffer();
  private _serverParams: StdioServerParameters;
  private _stderrStream: PassThrough | null = null;
  private _isCleanup: boolean = false;
  private _spawnedAt: number | null = null;

  // Set when the spawned process dies before cleanup (a crash, not a
  // deliberate close). send() rejects with this instead of the passive
  // "Not connected" marker so the caller can distinguish a connect-stage
  // spawn failure from a session torn down after a successful connect.
  private _rejectError: Error | null = null;
  private _hasClosed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  onprocesscrash?: (exitCode: number | null, signal: string | null) => void;

  constructor(server: StdioServerParameters) {
    this._serverParams = server;
    if (server.stderr === "pipe" || server.stderr === "overlapped") {
      this._stderrStream = new PassThrough();
    }
  }

  /**
   * Starts the server process and prepares to communicate with it.
   */
  async start(): Promise<void> {
    if (this._process) {
      throw new Error(
        "StdioClientTransport already started! If using Client class, note that connect() calls start() automatically.",
      );
    }

    // Fail fast on a missing launcher instead of spawning a zombie process
    // that dies in seconds. A launch command that doesn't exist makes
    // `spawn` succeed (the error only surfaces asynchronously), the process
    // exits non-zero before the connect handshake, and the pool's connect
    // retry loop then hammers the missing launcher for minutes (once per
    // sync pass) — tripping the circuit breaker and reporting "Not connected"
    // for a server that will never come up. The spawn-concurrency gate keeps
    // this check at O(1) per cold server.
    //
    // Semantics of MCP_STDIO_MISSING_LAUNCHER_ABORT: default is ON (missing
    // launcher is always fatal — the process can never initialize). Set "0" to
    // allow a deliberately-missing launcher (boot-path test, or a server whose
    // launcher is expected to be produced on first request).
    const launcher = this._serverParams.command;
    if (
      launcher &&
      !commandIsExecutable(launcher) &&
      process.env.MCP_STDIO_MISSING_LAUNCHER_ABORT !== "0"
    ) {
      throw new Error(
        `MCP stdio launcher not found (${launcher}) — refusing to spawn; set MCP_STDIO_MISSING_LAUNCHER_ABORT=0 to allow the boot-path test`,
      );
    }

    return new Promise((resolve, reject) => {
      this._spawnedAt = Date.now();
      this._process = spawn(
        this._serverParams.command,
        this._serverParams.args ?? [],
        {
          // merge default env with server env because mcp server needs some env vars
          env: {
            ...getDefaultEnvironment(),
            ...this._serverParams.env,
          },
          stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"],
          shell: false,
          signal: this._abortController.signal,
          windowsHide: process.platform === "win32" && isElectron(),
          cwd: this._serverParams.cwd,
          detached: true,
        },
      );

      // Unref the child process so it doesn't keep the parent alive
      this._process.unref();

      this._process.on("error", (error) => {
        if (error.name === "AbortError") {
          // Expected when close() is called.
          this.onclose?.();
          return;
        }

        reject(error);
        this.onerror?.(error);
      });

      this._process.on("spawn", () => {
        logger.info(
          `[transport.start] spawned PID ${this._process?.pid} — command: ${this._serverParams.command}`,
        );
        resolve();
      });

      this._process.on("close", (code, signal) => {
        // Passive disconnect: a spawned process that died after start() but
        // before the client is torn down must REJECT the pending send()
        // promise. Without this, Protocol.request()'s promise hangs until
        // the request timeout while the transport sits half-closed — and any
        // later request surfaces the SDK's bare "Not connected" instead of
        // this process's exit reason, so the recovery path can't tell a real
        // connect failure from a torn-down session.
        if (
          !this._isCleanup &&
          this._process &&
          !this._hasClosed &&
          (code !== 0 || signal)
        ) {
          this._hasClosed = true;
          this._rejectError = new Error(
            `MCP server process exited unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "null"})`,
          );
        }

        // Only emit crash event if this wasn't a clean shutdown
        if (!this._isCleanup && (code !== 0 || signal)) {
          logger.warn(`Process crashed with code: ${code}, signal: ${signal}`);
          // A stdio server that dies fast with a non-zero exit (long before
          // the connect timeout) is failing on local cache resolution —
          // "npx cache corrupted" etc. With MCP_CACHE_HEAL=1, purge the cache
          // it resolves from so the pool's retry runs against a fresh store
          // instead of a corrupt one. Healthy warm caches are never touched.
          maybeHealOnFastCrash(
            this._serverParams.command,
            code,
            Date.now() - (this._spawnedAt ?? Date.now()),
          );
          logger.info(
            `Calling onprocesscrash handler: ${this.onprocesscrash ? "handler exists" : "no handler"}`,
          );
          this.onprocesscrash?.(code, signal);
        }

        this._process = undefined;
        this.onclose?.();
      });

      this._process.stdin?.on("error", (error) => {
        this.onerror?.(error);
      });

      this._process.stdout?.on("data", (chunk) => {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      });

      this._process.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });

      if (this._stderrStream && this._process.stderr) {
        this._process.stderr.pipe(this._stderrStream);
      }
    });
  }

  /**
   * The stderr stream of the child process, if `StdioServerParameters.stderr` was set to "pipe" or "overlapped".
   *
   * If stderr piping was requested, a PassThrough stream is returned _immediately_, allowing callers to
   * attach listeners before the start method is invoked. This prevents loss of any early
   * error output emitted by the child process.
   */
  get stderr(): Stream | null {
    if (this._stderrStream) {
      return this._stderrStream;
    }

    return this._process?.stderr ?? null;
  }

  /**
   * The child process pid spawned by this transport.
   *
   * This is only available after the transport has been started.
   */
  get pid(): number | null {
    return this._process?.pid ?? null;
  }

  private processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }

        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async close(): Promise<void> {
    this._isCleanup = true;

    const proc = this._process;
    const pid = proc?.pid ?? null;

    if (pid && proc) {
      // Register the "close" listener BEFORE sending any signal so a fast-exiting
      // child cannot emit "close" in between and cause the promise to time out.
      const exitedPromise = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        proc.once("close", () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      this._abortController.abort();

      try {
        process.kill(-pid, "SIGTERM");
        logger.info(`[transport.close] SIGTERM sent to process group -${pid}`);
      } catch (error) {
        logger.warn(
          `[transport.close] SIGTERM failed for process group -${pid}:`,
          error,
        );
      }

      // Wait up to 5 seconds for graceful shutdown, then escalate to SIGKILL
      const exited = await exitedPromise;

      if (!exited) {
        logger.warn(
          `[transport.close] Process ${pid} still alive after 5s — sending SIGKILL`,
        );
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // Process may have already exited between the timeout check and the kill
        }
      }
    }

    this._process = undefined;
    this._readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._process?.stdin) {
        reject(this._rejectError ?? new Error("Not connected"));
        return;
      }

      const json = serializeMessage(message);
      if (this._process.stdin.write(json)) {
        resolve();
      } else {
        this._process.stdin.once("drain", resolve);
      }
    });
  }
}

function isElectron() {
  return "type" in process;
}
