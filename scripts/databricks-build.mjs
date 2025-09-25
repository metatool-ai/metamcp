#!/usr/bin/env node
import { chmodSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PNPM_VERSION = "9.15.9";
const PNPM_LINUX_URL = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-x64`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    ...options,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function ensureLinuxPnpm() {
  const pnpmPath = path.join(repoRoot, "scripts", "pnpm-linuxstatic");
  if (!existsSync(pnpmPath)) {
    run("curl", ["-L", PNPM_LINUX_URL, "-o", pnpmPath]);
    chmodSync(pnpmPath, 0o755);
  }
  const pnpmAlias = path.join(repoRoot, "scripts", "pnpm");
  if (!existsSync(pnpmAlias)) {
    try {
      chmodSync(pnpmPath, 0o755);
      // create symlink so tools expecting `pnpm` can resolve the binary
      run("ln", ["-sf", pnpmPath, pnpmAlias]);
    } catch (error) {
      // ignore failures; direct path will still work
    }
  }
  const scriptsDir = path.dirname(pnpmPath);
  if (process.env.PATH && !process.env.PATH.includes(scriptsDir)) {
    process.env.PATH = `${scriptsDir}:${process.env.PATH}`;
  }
  process.env.npm_execpath = pnpmPath;
  process.env.npm_node_execpath = process.execPath;
  process.env.npm_config_user_agent = `pnpm/${PNPM_VERSION}`;
  return pnpmPath;
}

function getPnpmCommand() {
  if (process.platform === "linux") {
    return { command: ensureLinuxPnpm(), args: [] };
  }

  const local = spawnSync("pnpm", ["--version"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (local.status === 0) {
    return { command: "pnpm", args: [] };
  }

  return { command: "npx", args: [`pnpm@${PNPM_VERSION}`] };
}

function runPnpm(args) {
  if (!process.env.PNPM_YES) {
    process.env.PNPM_YES = "true";
  }
  const { command, args: baseArgs } = getPnpmCommand();
  run(command, [...baseArgs, ...args]);
}

function prepareWorkspace() {
  const nodeModulesPath = path.join(repoRoot, "node_modules");

  if (existsSync(nodeModulesPath)) {
    const pnpmMarker = path.join(nodeModulesPath, ".pnpm");
    if (!existsSync(pnpmMarker)) {
      rmSync(nodeModulesPath, { recursive: true, force: true });
    }
  }
}

function hydrateAppUrlEnv() {
  const databricksAppUrl = process.env.DATABRICKS_APP_URL;
  if (!databricksAppUrl) {
    return;
  }

  const resolved = databricksAppUrl.startsWith("http")
    ? databricksAppUrl
    : `https://${databricksAppUrl}`;

  process.env.APP_URL = resolved;
  process.env.NEXT_PUBLIC_APP_URL = resolved;
}

function main() {
  hydrateAppUrlEnv();
  prepareWorkspace();
  runPnpm(["install", "--frozen-lockfile"]);
  runPnpm(["--filter", "@repo/zod-types", "run", "build"]);
  runPnpm(["--filter", "@repo/trpc", "run", "build"]);
  runPnpm(["run", "build:turbo"]);
}

main();
