import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import logger from "@/utils/logger";

/**
 * Self-healing for the per-user package caches that stdio MCP servers resolve
 * their binaries from (`npx -y <pkg>` / `uvx <pkg>` / `bunx <pkg>`). Spawned
 * servers inherit HOME (see DEFAULT_INHERITED_ENV_VARS) and no
 * npm_config_cache / UV_CACHE_DIR override is applied, so every cold spawn
 * writes the SAME cache dirs.
 *
 * npm's `_cacache` is NOT safe for concurrent writers. The pre-fix retry
 * storm (5 retries × ~20 stdio servers) means several `npx` processes can be
 * extracting the same entry at once → torn entries → "npx cache corrupted" /
 * EINTEGRITY. Worse, the corruption is CASCADING: once an entry is corrupt,
 * every spawn referencing it fails fast, each failure schedules another
 * retry, and each retry is another concurrent writer. Two replicas sharing a
 * persistent cache volume produces the same stomping by a second mechanism.
 *
 * This module breaks the cascade OPT-IN via MCP_CACHE_HEAL=1 (default off):
 *   - prewarm verifies the npm cache and purges it when verification fails;
 *   - a cold stdio spawn that crashes fast (non-zero exit well inside the
 *     connect timeout) cleans the cache it uses ONCE per process lifetime,
 *     so the pool's retry runs against a fresh cache instead of the corrupt
 *     one.
 *
 * Nothing runs unless the operator opts in; a healthy warm cache is never
 * touched.
 */

export type CacheKind = "npm" | "uv" | "bun";

export const CACHE_DIRS: Record<
  CacheKind,
  { label: string; dir: () => string }
> = {
  npm: {
    label: "npm",
    dir: () => process.env.npm_config_cache ?? join(homedir(), ".npm"),
  },
  uv: {
    label: "uv",
    dir: () => process.env.UV_CACHE_DIR ?? join(homedir(), ".cache", "uv"),
  },
  bun: {
    label: "bun",
    dir: () => join(homedir(), ".bun"),
  },
};

export function cacheDirFor(kind: CacheKind): string {
  return CACHE_DIRS[kind].dir();
}

export function cacheHealingEnabled(): boolean {
  const v = process.env.MCP_CACHE_HEAL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** The fast-fail window: a stdio spawn that dies this quickly with a non-zero
 * exit is failing on local resolution/extraction (corrupt cache, missing
 * entry), not on a slow network download — a network timeout would surface as
 * the connect timeout instead. */
function fastFailMs(): number {
  const raw = parseInt(process.env.MCP_CACHE_HEAL_FAST_FAIL_MS || "8000", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
}

/** Infer which package cache a server command resolves from. */
export function cacheKindForCommand(
  command: string | undefined,
): CacheKind | undefined {
  if (!command) {
    return undefined;
  }
  const base = command.split(/\s+/)[0].toLowerCase();
  if (/npx|node_modules[\\/]\.bin[\\/]/.test(command) || /^npm/.test(base)) {
    return "npm";
  }
  if (/^uvx|^uv\b/.test(base)) {
    return "uv";
  }
  if (/^bunx|^bun\b/.test(base)) {
    return "bun";
  }
  return undefined;
}

/** Caches healed so far this process lifetime — a corrupt cache heals ONCE,
 * never on every retry, so a genuinely broken server can't trigger a
 * wipe-per-attempt loop. */
const healedKinds = new Set<CacheKind>();

export function healCacheKind(kind: CacheKind): boolean {
  if (healedKinds.has(kind)) {
    return false;
  }
  const dir = cacheDirFor(kind);
  try {
    rmSync(dir, { recursive: true, force: true });
    healedKinds.add(kind);
    logger.warn(
      `[cache-health] removed ${CACHE_DIRS[kind].label} cache at ${dir} — the pool will rebuild it on the next spawn.`,
    );
    return true;
  } catch (error) {
    logger.error(
      `[cache-health] failed to remove ${CACHE_DIRS[kind].label} cache at ${dir}:`,
      error,
    );
    return false;
  }
}

function runCapture(
  command: string,
  args: string[],
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: -1, output: String(error) });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, output });
    });
  });
}

/** `npm cache verify` is the corruption DETECTOR + self-healer for the
 * `_cacache` store: it re-checks every entry and removes the corrupt ones. A
 * non-zero exit (or a verify error in the output) means it could not fully
 * verify — the store is bad enough that a full purge is the reliable fix. */
export async function verifyAndHealNpmCache(): Promise<boolean> {
  if (!cacheHealingEnabled()) {
    return false;
  }
  const result = await runCapture("npm", ["cache", "verify"]);
  const suspicious =
    /verify|integrity|corrupt|index/i.test(result.output) &&
    /error|fail/i.test(result.output);
  if (result.code === 0 && !suspicious) {
    logger.info(
      `[cache-health] npm cache verified clean (${result.output.trim().slice(0, 200) || "ok"})`,
    );
    return false;
  }
  logger.warn(
    `[cache-health] npm cache verify reported problems (${result.code}) — ${result.output.trim().slice(0, 300) || "no output"}. Purging the npm cache so prewarm/spawns rebuild it.`,
  );
  return healCacheKind("npm");
}

/**
 * Call from a stdio spawn that died fast with a non-zero exit. Cleans the
 * cache the command resolves from once per process lifetime, so the pool's
 * next retry runs on a fresh cache instead of the corrupt one.
 */
export function maybeHealOnFastCrash(
  command: string | undefined,
  exitCode: number | null,
  elapsedMs: number,
): boolean {
  if (!cacheHealingEnabled()) {
    return false;
  }
  if (exitCode === 0 || exitCode === null) {
    return false;
  }
  if (elapsedMs > fastFailMs()) {
    return false;
  }
  const kind = cacheKindForCommand(command);
  if (!kind) {
    return false;
  }
  return healCacheKind(kind);
}

/** For tests. */
export function resetHealedKindsForTest(): void {
  healedKinds.clear();
}
