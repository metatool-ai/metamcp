#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PNPM_VERSION = "9.15.9";
const PNPM_LINUX_URL = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-x64`;

function spawnService(name, command, args, options) {
  const child = spawn(command, args, {
    stdio: "inherit",
    ...options,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${name} exited with signal ${signal}`);
    } else {
      console.log(`${name} exited with code ${code}`);
    }
    shutdown(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`${name} failed to start`, error);
    shutdown(1);
  });

  return child;
}

let backend;
let frontend;
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (backend && !backend.killed) {
    backend.kill("SIGTERM");
  }
  if (frontend && !frontend.killed) {
    frontend.kill("SIGTERM");
  }

  setTimeout(() => {
    process.exit(code);
  }, 1000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function ensureEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  process.env.FRONTEND_PORT = process.env.FRONTEND_PORT || "12008";
  process.env.BACKEND_PORT = process.env.BACKEND_PORT || "12009";
  process.env.APP_URL = process.env.APP_URL || `http://127.0.0.1:${process.env.FRONTEND_PORT}`;
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
}

function ensureLinuxPnpm() {
  const pnpmPath = path.join(repoRoot, "scripts", "pnpm-linuxstatic");
  if (!existsSync(pnpmPath)) {
    const download = spawnSync("curl", ["-L", PNPM_LINUX_URL, "-o", pnpmPath], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (download.stdout) process.stdout.write(download.stdout);
    if (download.stderr) process.stderr.write(download.stderr);
    if (download.status !== 0) {
      throw new Error("Failed to download pnpm static binary");
    }
    chmodSync(pnpmPath, 0o755);
  }
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

async function main() {
  ensureEnv();

  const backendEnv = {
    ...process.env,
    PORT: process.env.BACKEND_PORT,
  };

  const frontendEnv = {
    ...process.env,
    PORT: process.env.FRONTEND_PORT,
  };

  backend = spawnService(
    "backend",
    "node",
    ["dist/index.js"],
    {
      cwd: path.join(repoRoot, "apps", "backend"),
      env: backendEnv,
    },
  );

  const { command: pnpmCommand, args: pnpmArgs } = getPnpmCommand();

  frontend = spawnService(
    "frontend",
    pnpmCommand,
    [...pnpmArgs, "start"],
    {
      cwd: path.join(repoRoot, "apps", "frontend"),
      env: frontendEnv,
    },
  );
}

main().catch((error) => {
  console.error("Failed to launch MetaMCP services", error);
  shutdown(1);
});
