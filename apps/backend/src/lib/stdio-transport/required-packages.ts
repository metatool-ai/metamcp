import { spawn } from "node:child_process";
import {
  accessSync,
  chownSync,
  constants,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import logger from "@/utils/logger";

import {
  cacheHealingEnabled,
  type CacheKind,
  healCacheKind,
  verifyAndHealNpmCache,
} from "./cache-health";
/**
 * Required-package INSTALL phase for stdio MCP servers.
 *
 * This is NOT an optional prewarm — it is a blocking bootstrap install, like
 * deps before the app serves. Every package an operator lists is installed into
 * the per-user caches/locations the spawned servers resolve from, and the web
 * service does NOT begin listening until the install phase completes. A package
 * that fails to install is logged ("Failed: <reason>") and the install
 * continues — the pool still falls back to on-demand install for the failure,
 * and boot is never held up by one bad package.
 *
 * The operator configures the lists via simple ENV (space/comma separated):
 *
 *   REQUIRED_PACKAGES_NPM="pkg1 pkg2"              # npm install -g → ~/.npm-global
 *   REQUIRED_PACKAGES_UVX="uvxpkg1 uvxpkg2"        # uv tool install → ~/.cache/uv
 *   REQUIRED_PACKAGES_UVX_ARGS="--from git+… --with … python -m …,…"  # atomic uvx
 *   REQUIRED_PACKAGES_BUN="bunpkg1"                # bun add -g → ~/.bun
 *   REQUIRED_PACKAGES_GIT_NPM="git+https://…#<subdir>|#<command>|#<args>" # git clone + npm build
 *   REQUIRED_PACKAGES_BUN_GIT="git+https://…#<subdir>|#<command>|#<args>" # git clone + bun build
 *
 * The npm/uvx/bun lists install into standard per-user cache dirs
 * (~/.npm-global, ~/.cache/uv, ~/.bun) which are both volume-mountable AND
 * persist across container restarts without a volume — the install phase is
 * what makes a fresh container deterministic (rule: once installed, a package
 * is NOT installed again). The image exports
 * REQUIRED_PACKAGES_NPM_PREFIX=$HOME/.npm-global so a missing env var can
 * never silently rebuild the whole tree into the image default prefix (/usr).
 *
 * NFS-subpath ownership: when the per-user cache dirs are NFS mounts they can
 * come up root-owned while the runner is UID 1001. Before installing, the
 * phase verifies each dir exists + is writable and attempts a chown to the
 * running user, logging LOUDLY when it cannot — a silently-failing install is
 * worse than a visible one.
 *
 * PERF: the install phase is one BATCHED installer invocation PER GROUP, NOT one
 * invocation per package. npm install -g re-resolves + re-reconciles the ENTIRE
 * global tree (~/.npm-global) on every invocation, so installing 20 packages
 * serially one-at-a-time costs 20 full resolution passes even when every
 * tarball is warm-cached. Passing the whole list to a single `npm install -g
 * <pkg1> <pkg2> …` (or `bun add -g …`) resolves + dedupes shared deps ONCE.
 * That is the "do them all at once" half of the fix.
 *
 * The "store in a static location" half is the skip-if-present guard: each
 * group checks the static per-user install location (the npm global prefix dir,
 * bun's ~/.bun, uv's ~/.cache/uv) for ALL of its requested packages up front.
 * A package that already exists is logged "Pre-installed <pkg> (cached,
 * skipping install)" and the whole group's install is SKIPPED when every
 * package is present — a warm cache/install location makes boot a fast no-op
 * instead of 20 full tree reconciliations.
 *
 * The install is strictly SERIAL: the six groups (npm/uvx/uvxArgs/bun/gitNpm/
 * bunGit) run one at a time, awaiting the previous — no worker pool, no
 * concurrency knob. A serial bootstrap keeps a cold boot's npm/uvx/bun installs
 * from racing each other's caches (npm/npx/uv/bun all resolve the same per-user
 * dirs) and keeps the install's stdout readable in order. Batching replaces
 * per-package invocations, NOT per-group parallelism — concurrency stays out.
 */

function parseList(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse the UVX_ARGS list: COMMA-separated only. Each entry is an atomic `uvx
 * <args>` invocation that contains spaces (e.g. `--from git+https://… --with
 * mcp==1.29.0 python -m obsidian_self_mcp.server`), so splitting on whitespace
 * would shred it into per-token packages.
 */
function parseArgsList(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sanitize the repo URL parsed from a `|#`-separated git spec. A spec like
 * `git+https://…#|#|#` leaves a lone trailing `|` (or `|#` padding) after the
 * split — `git clone git+https://…repo|` fails with exit 128 and the dest name
 * becomes `repo|`. Trim whitespace, strip a lone trailing `|` (the pad that
 * survives when the optional `|#`-parts are empty), and refuse a repo that does
 * not look like a `git+https://…` URL so a malformed spec can never reach
 * `git clone` with a mangled URL/dest.
 */
export function sanitizeGitRepo(repo: string): string | null {
  const trimmed = repo.trim().replace(/\|+$/, "");
  if (
    !trimmed.startsWith("git+https://") &&
    !trimmed.startsWith("git+ssh://")
  ) {
    return null;
  }
  return trimmed;
}

/** Split a `git+https://…` spec into its `|#`-separated parts. The repo is
 * sanitized (trailing-`|`/whitespace stripped, `git+https://`/`git+ssh://`
 * validated) so the dest name is ALWAYS derived from a clean URL. */
export function parseGitSpec(spec: string): {
  repo: string;
  subdir: string;
  cmd: string;
  args: string[];
} {
  const [rawRepo, ...rest] = spec.split("|#");
  const repo = sanitizeGitRepo(rawRepo) ?? rawRepo.trim().replace(/\|+$/, "");
  const subdir = rest[0] ?? "";
  const cmd = rest[1] ?? "";
  const args = rest[2] ? rest[2].split(/[\s,]+/).filter(Boolean) : [];
  return { repo, subdir, cmd, args };
}

function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  cwd?: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      cwd,
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
 * The static per-user location a package of this kind lands in. The npm prefix
 * (config- or env-derived) is cached after the first resolution; bun and uv
 * locations are fixed.
 */
const npmPrefixCache = new Map<string, string>();

async function npmGlobalPrefix(): Promise<string> {
  const key = process.env.REQUIRED_PACKAGES_NPM_PREFIX || "default";
  const cached = npmPrefixCache.get(key);
  if (cached) return cached;
  // Resolve once (npm config get prefix is cheap and authoritative).
  const result = await run("npm", ["config", "get", "prefix"]);
  const prefix =
    result.code === 0 && result.output.trim()
      ? result.output.trim()
      : `${homedir()}/.npm-global`;
  npmPrefixCache.set(key, prefix);
  return prefix;
}

async function installLocationFor(kind: CacheKind): Promise<string> {
  if (kind === "npm") {
    return npmGlobalPrefix();
  }
  if (kind === "bun") {
    // bun add -g resolves its global dir via `bun pm`-style logic; a static
    // ~/.bun (or the same prefix bun's install resolves, e.g. XDG_DATA_HOME)
    // is the target.
    return process.env.BUN_INSTALL || `${homedir()}/.bun`;
  }
  // uv — `uv tool install` lands tools in ~/.local/bin (exe) and
  // ~/.cache/uv/archive-v0 (wheels). An already-installed tool is detected via
  // the resolved tool dir or the executable in the bin dir.
  return process.env.UV_TOOL_BIN_DIR || `${homedir()}/.local/bin`;
}

/**
 * Does the static install location already have this package? Scoped names
 * (@scope/name) nest under node_modules/@scope/name; bare names sit directly
 * under node_modules. Used by the skip-if-present guard so a warm install
 * location short-circuits the whole group.
 */
function pkgEntryPath(
  installLocation: string,
  kind: CacheKind,
  pkg: string,
): string {
  if (pkg.startsWith("@")) {
    const [scope, name] = pkg.split("/");
    return join(installLocation, "node_modules", scope, name || "");
  }
  return join(installLocation, "node_modules", pkg);
}

/**
 * Per-kind "is this package present in its static install location" probe.
 * npm/bun: the package's node_modules entry exists. uv: the tool's executable
 * exists in the tool bin dir (uv tool install is a no-op when already
 * installed, so re-installing is free-ish, but a present exe still skips it).
 */
function pkgIsInstalled(
  location: string,
  kind: CacheKind,
  pkg: string,
): boolean {
  if (kind === "uv") {
    const [spec] = pkg.split("==");
    const name = spec.includes("/") ? spec.split("/").pop() || spec : spec;
    return existsSync(join(location, name));
  }
  return existsSync(pkgEntryPath(location, kind, pkg));
}

/**
 * Install ONE BATCH of packages in a single installer invocation, logging the
 * per-package start lines the operator asked for ("Starting package
 * pre-install: <pkg>") up front and per-package outcomes after. A package that
 * fails is logged "Failed: <pkg> (…)" and the rest of the list still installs —
 * a batched npm/bun install continues with the remaining packages after a
 * failed one, and uvx arg-strings are inherently one-atomic-command-per-URL.
 *
 * SKIP-IF-PRESENT (static location): before invoking the installer, every
 * package in the batch is checked against its static per-user install location.
 * A package already there is logged "Pre-installed <pkg> (cached, skipping
 * install)" and, when ALL packages are present, the installer is NOT invoked at
 * all — a warm cache makes the whole group a fast no-op. Never throws for a
 * package failure — it logs and returns the exit code so the rest of the list
 * still installs.
 */
async function installWith(
  label: string,
  defaultCommand: string,
  commandEnvName: string,
  kind: CacheKind,
  args: string[],
  packages: string[],
): Promise<void> {
  if (packages.length === 0) return;
  const cmd = process.env[commandEnvName] || defaultCommand;

  const runEnv: Record<string, string> = { npm_config_yes: "true" };
  if (kind === "npm") {
    runEnv.npm_config_prefix =
      process.env.REQUIRED_PACKAGES_NPM_PREFIX || `${homedir()}/.npm-global`;
  }

  if (kind === "npm" && cacheHealingEnabled()) {
    await verifyAndHealNpmCache();
  }

  // Skip-if-present: a package already in its static install location is
  // already installed — re-running the installer would re-resolve + reconcile
  // the ENTIRE global tree for nothing. Resolve the location once per group and
  // check every package up front.
  const location = await installLocationFor(kind);
  const missing: string[] = [];
  for (const pkg of packages) {
    const isArgString = kind === "uv" && pkg.trim().startsWith("--");
    if (isArgString) {
      // uvx ARG-STRINGS (git-URL packages in REQUIRED_PACKAGES_UVX_ARGS) are
      // one atomic `uvx <args> --help` invocation, not an install — `uv tool
      // install` has no registry package to resolve for `--from git+…`. There
      // is no static entry to probe for them; they must run.
      missing.push(pkg);
    } else if (pkgIsInstalled(location, kind, pkg)) {
      logger.info(`Pre-installed ${pkg} (cached, skipping install)`);
    } else {
      missing.push(pkg);
    }
  }

  if (missing.length === 0) {
    // Every package already present in its static location — warm boot no-op.
    logger.info(
      `[required-packages] ${label}: all ${packages.length} packages already installed (${location}); skipping install`,
    );
    return;
  }
  for (const pkg of missing) {
    logger.info(`Starting package pre-install: ${pkg}`);
  }

  // BATCH: install the whole missing list in ONE installer invocation. npm
  // install -g <pkg1> <pkg2> … and bun add -g <pkg1> <pkg2> … resolve + dedupe
  // shared deps in a single pass instead of paying a full global-tree
  // reconciliation per package. uvx arg-strings are still one atomic invocation
  // per URL (inherently un-batchable) — serial, as before.
  const isArgString = kind === "uv" && missing[0].trim().startsWith("--");
  const batchResult = await run(
    cmd,
    isArgString ? [...parseList(missing[0]), "--help"] : [...args, ...missing],
    runEnv,
  );
  if (batchResult.code === 0) {
    for (const pkg of missing) {
      logger.info(
        `Pre-installed ${pkg} (${batchResult.output.trim().slice(0, 200) || "ok"})`,
      );
    }
  } else {
    for (const pkg of missing) {
      logger.warn(
        `Failed: ${pkg} (${batchResult.code}) — ${batchResult.output.trim().slice(0, 300) || "no output"}. Spawns will fall back to on-demand install.`,
      );
    }
  }

  // uvx fallback: `uv tool install <pkg>` only works when the package ships an
  // executable named exactly <pkg> (postgres-mcp, jupyter-mcp-server do NOT —
  // they are module-runners invoked via `uvx <pkg>`). When the batched install
  // failed, warm each plain uv package with a `uvx <pkg> --help` so the wheel
  // lands in ~/.cache/uv.
  if (kind === "uv" && batchResult.code !== 0 && !isArgString) {
    const warmResult = await run(
      process.env.REQUIRED_PACKAGES_UVX_CMD || "uvx",
      [...parseList(missing[0]), "--help"],
      { npm_config_yes: "true" },
    );
    if (warmResult.code === 0) {
      for (const pkg of missing) {
        logger.info(
          `Pre-installed ${pkg} via uvx --help cache-warm (${warmResult.output.trim().slice(0, 200) || "ok"})`,
        );
      }
    } else {
      for (const pkg of missing) {
        logger.warn(
          `Failed: ${pkg} cache-warm fallback (${warmResult.code}) — ${warmResult.output.trim().slice(0, 300) || "no output"}. Spawns will fall back to on-demand uvx.`,
        );
      }
    }
  }

  // If EVERY requested package failed AND the cache could be corrupt, purge it
  // once and retry the whole group once. Transient failures already logged
  // their warning above and are NOT retried here.
  const allFailed = missing.length > 0 && batchResult.code !== 0;
  if (allFailed && cacheHealingEnabled() && healCacheKind(kind)) {
    logger.warn(
      `[required-packages] ${label}: all ${missing.length} pre-installs failed; purged ${kind} cache, retrying group once.`,
    );
    for (const pkg of missing) {
      const isArgStringPkg = kind === "uv" && pkg.trim().startsWith("--");
      const result = await run(
        cmd,
        isArgStringPkg ? [...parseList(pkg), "--help"] : [...args, pkg],
        runEnv,
      );
      logger.info(
        result.code === 0
          ? `Pre-installed ${pkg} (retry)`
          : `Failed: ${pkg} (retry, ${result.code})`,
      );
    }
  }
}

/**
 * NFS-mounted per-user cache dirs (~/.local, ~/.npm-global, ~/.npm, ~/.bun)
 * can come up root-owned — the runner (UID 1001, `nextjs`) then cannot write,
 * and every install silently fails. mkdir -p + attempt chown to the running
 * user + verify writability, logging LOUDLY on failure (chown on NFS needs
 * root privileges the process may not have; when it can't fix ownership the
 * install MUST fail loudly, not silently). This only ADDS ownership — an
 * existing user-owned dir is left untouched.
 */
export function ensureCacheDirsWritable(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
      let uid = -1;
      let gid = -1;
      try {
        const stat = statSync(dir);
        if (stat.uid === process.getuid?.()) {
          continue; // Already ours — leave it alone.
        }
        uid = process.getuid?.() ?? -1;
        gid = process.getgid?.() ?? -1;
      } catch {
        // stat failed (unlikely post-mkdir); fall through to chown attempt.
      }
      if (uid >= 0 && gid >= 0) {
        try {
          chownSync(dir, uid, gid);
        } catch (error) {
          logger.error(
            `[required-packages] cache dir ${dir} is not owned by the running user and could not be chown'd (${error instanceof Error ? error.message : String(error)}). Package installs into it will FAIL — fix the mount ownership (e.g. re-mount the NFS share with root_squash off, or chown -R <uid>:<gid> ${dir} on the host).`,
          );
          continue;
        }
      }
      try {
        accessSync(dir, constants.W_OK);
      } catch (error) {
        logger.error(
          `[required-packages] cache dir ${dir} is NOT writable by the running user (${error instanceof Error ? error.message : String(error)}). Package installs into it will FAIL silently.`,
        );
      }
    } catch (error) {
      logger.error(
        `[required-packages] could not create/verify cache dir ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Install a git-based package INLINE (no sidecar): clone, install deps, build,
 * leaving a ready-to-run binary/entry at ~/.local/bin/<name>. Supports:
 *  - npm-built servers (e.g. netbirdio/netbird-mcp: `npm i && npm run build` →
 *    node dist/bin/stdio.js)
 *  - bun-compiled servers (e.g. nikkomiu/pocketid-mcp: `bun install && bun build
 *    … --compile`)
 *  - bare binaries (e.g. `go install`)
 *
 * Spec format: `git+https://…|#<subdir>|#<cmd>|#<arg1 arg2>` — the `|#`-parts
 * are optional; cmd defaults to `npm`/`bun` based on the group.
 */
async function installGitWith(
  label: string,
  defaultCmd: string,
  packages: string[],
): Promise<void> {
  if (packages.length === 0) return;
  const binDir = `${homedir()}/.local/bin`;
  // Ensure the bin dir exists (mkdir -p) — created lazily on first git install.
  await run("mkdir", ["-p", binDir]);
  // Self-heal the per-user cache dirs this group writes into (NFS ownership).
  ensureCacheDirsWritable([
    binDir,
    `${homedir()}/.local/src`,
    `${homedir()}/.npm`,
    `${homedir()}/.npm-global`,
    `${homedir()}/.bun`,
  ]);

  for (const spec of packages) {
    const { repo, subdir, cmd: specCmd, args } = parseGitSpec(spec);
    if (!repo.startsWith("git+https://") && !repo.startsWith("git+ssh://")) {
      logger.warn(
        `Failed: git spec "${spec}" — repo URL does not look like git+https://… (or git+ssh://…). Spawns will fall back to on-demand build.`,
      );
      continue;
    }
    // The `git+` prefix is the npm-install *scheme marker* ("this is a git
    // dependency"), NOT part of the URL. Passing it to `git clone` makes git
    // try the `remote-git+https` helper and fail (exit 128) — the mcp-assistant
    // ENOENT root cause. Strip it so the URL is a plain https:// or ssh:// that
    // `git clone` accepts directly.
    const cloneUrl = repo.replace(/^git\+/, "");
    const name =
      cloneUrl
        .split("/")
        .pop()
        ?.replace(/\.git$/, "") || "git-pkg";
    const dest = `${homedir()}/.local/src/${name}`;
    logger.info(`Starting package pre-install: ${name} (git ${cloneUrl})`);

    try {
      const binExists =
        (await run("test", ["-x", `${binDir}/${name}`])).code === 0;
      const destExists = (await run("test", ["-d", dest])).code === 0;
      if (!binExists || !destExists) {
        // Clone shallow (fast + cache-friendly). `cloneUrl` has the `git+`
        // marker stripped — see the loop top.
        const clone = await run("git", [
          "clone",
          "--depth",
          "1",
          cloneUrl,
          dest,
        ]);
        if (clone.code !== 0) {
          logger.warn(
            `Failed: ${name} (git clone ${clone.code}) — ${clone.output.trim().slice(0, 200)}. Spawns will fall back to on-demand build.`,
          );
          continue;
        }
      }

      const cwd = subdir ? `${dest}/${subdir}` : dest;
      const cmd = specCmd || defaultCmd;
      // npm group: install deps then build (the package ships a `build`
      // script, e.g. netbird-mcp `tsc -p tsconfig.json` → dist/bin/stdio.js).
      // bun group: `bun install` deps then `bun build --compile` → a single
      // binary.
      if (defaultCmd === "bun" && args.length === 0) {
        // A fresh clone has NO node_modules — `bun build src/index.ts` would
        // fail with `Could not resolve: "@modelcontextprotocol/sdk"` (the
        // pocketid-mcp failure). Install deps first.
        const bunInstall = await run(
          cmd,
          ["install", "--no-progress"],
          {},
          cwd,
        );
        if (bunInstall.code !== 0) {
          logger.warn(
            `Failed: ${name} (bun install ${bunInstall.code}) — ${bunInstall.output.trim().slice(0, 300)}. Spawns will fall back to on-demand build.`,
          );
          continue;
        }
        const build = await run(
          cmd,
          [
            "build",
            "src/index.ts",
            "--compile",
            "--outfile",
            `${binDir}/${name}`,
          ],
          {},
          cwd,
        );
        if (build.code !== 0) {
          logger.warn(
            `Failed: ${name} (bun build ${build.code}) — ${build.output.trim().slice(0, 300)}. Spawns will fall back to on-demand build.`,
          );
          continue;
        }
      } else {
        // npm-flavored command: `npm`, a qualified path (`/usr/bin/npm`), or a
        // spec-provided npm invocation. The git-npm group is npm-only, so a
        // non-npm command falls through to the generic install env.
        const isNpm =
          cmd === "npm" || /(^|\/)npm(\.js)?$/.test(cmd) || cmd === "pnpm";
        const installEnv: Record<string, string> = isNpm
          ? {
              // The container runs NODE_ENV=production, which makes `npm
              // install` SKIP devDependencies — a git-npm server whose build
              // needs typescript/tsc (netbird-mcp) then fails `npm run build`
              // with "tsc: not found". Force devDeps into the install so the
              // build step works out of the box, and pin NODE_ENV=development
              // so a dependency that keys on NODE_ENV sees a build context.
              npm_config_include: "dev",
              NODE_ENV: "development",
              // Point the install at the same per-user prefix the runtime
              // resolves (spawns + the global install phase), so the clone's
              // `node_modules/.bin` is complete and the built binary resolves
              // consistently with the rest of the pool.
              npm_config_prefix:
                process.env.REQUIRED_PACKAGES_NPM_PREFIX ||
                `${homedir()}/.npm-global`,
            }
          : {};
        const install = await run(
          cmd,
          args.length > 0 ? args : ["install", "--no-audit", "--no-fund"],
          installEnv,
          cwd,
        );
        if (install.code !== 0) {
          logger.warn(
            `Failed: ${name} (install ${install.code}) — ${install.output.trim().slice(0, 300)}. Spawns will fall back to on-demand build.`,
          );
          continue;
        }
        if (defaultCmd === "npm") {
          // npm-built servers ship a `build` script that must run after
          // install so the entry (dist/bin/stdio.js) exists. Run the build in
          // a development context too — the npm_config_include=dev is an
          // install-time setting, but NODE_ENV=development keeps a build
          // script that prunes/optimizes on NODE_ENV=production from breaking.
          const build = await run(
            cmd,
            ["run", "build"],
            isNpm ? { NODE_ENV: "development" } : {},
            cwd,
          );
          if (build.code !== 0) {
            logger.warn(
              `Failed: ${name} (npm run build ${build.code}) — ${build.output.trim().slice(0, 300)}. Spawns will fall back to on-demand build.`,
            );
            continue;
          }
        }
      }
      logger.info(`Pre-installed ${name} (built at ${dest})`);
    } catch (error) {
      logger.warn(
        `Failed: ${name} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}

/**
 * Run the required-package install phase. BLOCKING — call this before the HTTP
 * server starts listening, so packages land before any spawn can race them.
 * Never throws for package failures (per-package failures are logged and the
 * pool falls back to on-demand install), so boot always proceeds.
 *
 * The install lists come ONLY from the REQUIRED_PACKAGES_* env vars — no DB
 * derivation, no fallback to server names. Justin curates the env lists.
 *
 * Each group installs in ONE batched installer invocation (npm/bun accept the
 * whole package list) preceded by a skip-if-present guard over the static
 * per-user install location, so a warm cache makes the phase a fast no-op.
 */
export async function installRequiredPackages(): Promise<void> {
  const {
    npm: npmPackages,
    uvx: uvxPackages,
    uvxArgs: uvxArgPackages,
    bun: bunPackages,
    gitNpm: gitNpmPackages,
    bunGit: bunGitPackages,
  } = {
    npm: parseList(process.env.REQUIRED_PACKAGES_NPM),
    uvx: parseList(process.env.REQUIRED_PACKAGES_UVX),
    uvxArgs: parseArgsList(process.env.REQUIRED_PACKAGES_UVX_ARGS),
    bun: parseList(process.env.REQUIRED_PACKAGES_BUN),
    gitNpm: parseList(process.env.REQUIRED_PACKAGES_GIT_NPM),
    bunGit: parseList(process.env.REQUIRED_PACKAGES_BUN_GIT),
  };

  if (
    npmPackages.length +
      uvxPackages.length +
      uvxArgPackages.length +
      bunPackages.length +
      gitNpmPackages.length +
      bunGitPackages.length ===
    0
  ) {
    logger.info(
      "[required-packages] no REQUIRED_PACKAGES_* configured and no installable MCPs; skipping install phase",
    );
    return;
  }

  logger.info(
    `[required-packages] starting package pre-install (SERIAL, no concurrency): npm(${npmPackages.length}) uvx(${uvxPackages.length}) uvxArgs(${uvxArgPackages.length}) bun(${bunPackages.length}) gitNpm(${gitNpmPackages.length}) bunGit(${bunGitPackages.length})`,
  );

  // NFS-subpath ownership self-heal: the per-user cache dirs can come up
  // root-owned (NFS root_squash) and the runner is UID 1001 — verify/repair
  // ownership + writability BEFORE any install writes into them.
  ensureCacheDirsWritable([
    `${homedir()}/.npm-global`,
    `${homedir()}/.npm`,
    `${homedir()}/.bun`,
    `${homedir()}/.cache`,
    `${homedir()}/.cache/uv`,
    `${homedir()}/.local`,
    `${homedir()}/.local/bin`,
    `${homedir()}/.local/src`,
  ]);

  const tasks: Array<() => Promise<void>> = [];
  if (npmPackages.length > 0) {
    logger.info(
      `[required-packages] npm install list: ${npmPackages.join(" ")}`,
    );
    tasks.push(() =>
      installWith(
        "npm",
        "npm",
        "REQUIRED_PACKAGES_NPM_CMD",
        "npm",
        ["install", "-g"],
        npmPackages,
      ),
    );
  }
  if (uvxPackages.length > 0) {
    tasks.push(() =>
      installWith(
        "uvx",
        "uvx",
        "REQUIRED_PACKAGES_UVX_CMD",
        "uv",
        ["tool", "install"],
        uvxPackages,
      ),
    );
  }
  if (uvxArgPackages.length > 0) {
    tasks.push(() =>
      installWith(
        "uvx",
        "uvx",
        "REQUIRED_PACKAGES_UVX_CMD",
        "uv",
        ["tool", "install"],
        uvxArgPackages,
      ),
    );
  }
  if (bunPackages.length > 0) {
    tasks.push(() =>
      installWith(
        "bun",
        "bun",
        "REQUIRED_PACKAGES_BUN_CMD",
        "bun",
        ["add", "-g"],
        bunPackages,
      ),
    );
  }
  if (gitNpmPackages.length > 0) {
    tasks.push(() => installGitWith("git-npm", "npm", gitNpmPackages));
  }
  if (bunGitPackages.length > 0) {
    tasks.push(() => installGitWith("bun-git", "bun", bunGitPackages));
  }

  // SERIAL bootstrap: run each group one at a time, awaiting the previous. No
  // concurrency — a cold boot must not have npm/uvx/bun installs racing each
  // other's caches (npx, uv, and bun all resolve the same per-user dirs).
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      logger.error(
        "[required-packages] unexpected install task failure:",
        error,
      );
    }
  }

  logger.info("[required-packages] install phase complete");
}
