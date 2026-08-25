import { spawn } from "node:child_process";

import logger from "@/utils/logger";

import {
  cacheHealingEnabled,
  type CacheKind,
  healCacheKind,
  verifyAndHealNpmCache,
} from "./cache-health";

/**
 * Runtime prewarm for stdio MCP servers that install their package on first
 * spawn (npx -y / uvx / bunx). A cold spawn that has to download a large
 * package (30-60s+) blows past the connect timeout during a container
 * create/boot, when ~20 stdio servers all spawn at once.
 *
 * The operator opts in by setting environment variables; nothing is baked
 * into the image:
 *
 *   MCP_PREWARM_NPM="pkg1 pkg2"     # npm install -g (npx falls back to the
 *                                   #   global install, so `npx -y pkg1` no
 *                                   #   longer re-downloads)
 *   MCP_PREWARM_UVX="uvxpkg1 uvxpkg2"  # uv tool install (uvx resolves from
 *                                   #   ~/.cache/uv)
 *   MCP_PREWARM_BUN="bunpkg1"       # bun add -g (bunx resolves from the
 *                                   #   global bun cache)
 *   MCP_PREWARM_CONCURRENCY=2       # how many package managers to prewarm at
 *                                   #   once (default 2)
 *
 * Prewarm targets the standard per-user cache dirs, so it also pairs with a
 * persistent volume mounted on those dirs (e.g. /home/nextjs/.npm,
 * /home/nextjs/.cache/uv) to survive container recreates.
 */

function parseList(envValue: string | undefined): string[] {
  if (!envValue) {
    return [];
  }
  return envValue
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
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

/**
 * Prewarm packages ONE AT A TIME. A single package that fails (engine
 * mismatch — npm 10 aborts a whole batch install with exit 243 on one
 * `engines.node` violation — a bad build, a transient registry error) must
 * not block the rest of the list. Each package installs or logs its own
 * warning; the pool still falls back to on-demand spawn for the failures.
 *
 * Cache self-heal still applies at the GROUP level: the npm cache is verified
 * before the group starts, and if the whole group comes back failing (a
 * corrupt store), the cache is purged once and the group retried once.
 */
async function prewarmWith(
  label: string,
  defaultCommand: string,
  commandEnv: string,
  kind: CacheKind,
  args: string[],
  packages: string[],
): Promise<void> {
  if (packages.length === 0) {
    return;
  }
  // The env var (commandEnv) is an optional override; defaultCommand is the
  // real binary name (npm / uvx / bun) when it isn't set.
  const cmd = process.env[commandEnv] || defaultCommand;

  const installOne = async (pkg: string): Promise<number> => {
    // args is the "shape" of the install command per package manager, e.g.
    // ["install", "-g"] for npm — the package name is appended per install.
    const result = await run(cmd, [...args, pkg], { npm_config_yes: "true" });
    if (result.code === 0) {
      logger.info(
        `[prewarm] ${label}: pre-installed ${pkg} (${result.output.trim().slice(0, 200) || "ok"})`,
      );
    } else {
      logger.warn(
        `[prewarm] ${label}: failed to pre-install ${pkg} (${result.code}) — ${result.output.trim().slice(0, 300) || "no output"}. Spawns will fall back to on-demand install.`,
      );
    }
    return result.code;
  };

  if (kind === "npm" && cacheHealingEnabled()) {
    // npm's cache verify is the corruption detector; purge when it fails so
    // the installs below start from a clean store (avoids re-installing on
    // top of a corrupt entry).
    await verifyAndHealNpmCache();
  }

  // Pass 1 — install each package individually.
  const results = [];
  for (const pkg of packages) {
    results.push(await installOne(pkg));
  }

  // Pass 2 — if EVERY package failed AND the cache could be corrupt, purge it
  // once and retry the whole group once against the fresh store. Per-package
  // transient failures (one bad engine, one bad build) already logged their
  // warning in pass 1 and are NOT retried here.
  const allFailed = results.length > 0 && results.every((c) => c !== 0);
  if (allFailed && cacheHealingEnabled() && healCacheKind(kind)) {
    logger.warn(
      `[prewarm] ${label}: all ${packages.length} pre-installs failed; purged ${kind} cache, retrying group once.`,
    );
    for (const pkg of packages) {
      await installOne(pkg);
    }
  }
}

/**
 * Kick off the configured prewarm in the background (fire-and-forget).
 * Uses `npm install -g` / `uv tool install` / `bun add -g` so the packages
 * land in the user-level caches npx/uvx/bunx resolve from. Bounded to
 * MCP_PREWARM_CONCURRENCY package managers at once so a cold boot doesn't
 * spawn three heavy installers simultaneously.
 */
export function startRuntimePrewarm(): void {
  const npmPackages = parseList(process.env.MCP_PREWARM_NPM);
  const uvxPackages = parseList(process.env.MCP_PREWARM_UVX);
  const bunPackages = parseList(process.env.MCP_PREWARM_BUN);

  if (npmPackages.length + uvxPackages.length + bunPackages.length === 0) {
    logger.info(
      "[prewarm] no MCP_PREWARM_* packages configured; skipping runtime prewarm",
    );
    return;
  }

  const concurrency = parseInt(process.env.MCP_PREWARM_CONCURRENCY || "2", 10);
  logger.info(
    `[prewarm] starting runtime prewarm: npm(${npmPackages.length}) uvx(${uvxPackages.length}) bun(${bunPackages.length}) concurrency=${concurrency}`,
  );

  const tasks: Array<() => Promise<void>> = [];
  if (npmPackages.length > 0) {
    tasks.push(() =>
      prewarmWith(
        "npm",
        "npm",
        "MCP_PREWARM_NPM_CMD",
        "npm",
        ["install", "-g"],
        npmPackages,
      ),
    );
  }
  if (uvxPackages.length > 0) {
    tasks.push(() =>
      prewarmWith(
        "uvx",
        "uvx",
        "MCP_PREWARM_UVX_CMD",
        "uv",
        ["tool", "install"],
        uvxPackages,
      ),
    );
  }
  if (bunPackages.length > 0) {
    tasks.push(() =>
      prewarmWith(
        "bun",
        "bun",
        "MCP_PREWARM_BUN_CMD",
        "bun",
        ["add", "-g"],
        bunPackages,
      ),
    );
  }

  // Bounded: a strict worker pool of `concurrency` installers. Each worker
  // pulls the next task only after the previous one finishes, so the number
  // of concurrent installers never exceeds `concurrency` (a naive
  // `.finally(runNext)` re-entry can overshoot while a sibling is still
  // running).
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      try {
        await task();
      } catch (error) {
        // startRuntimePrewarm is fire-and-forget; a throwing installer must
        // not crash the process or stop the remaining workers.
        logger.error("[prewarm] unexpected prewarm task failure:", error);
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency && i < tasks.length; i += 1) {
    workers.push(worker());
  }
  void Promise.allSettled(workers);
}
