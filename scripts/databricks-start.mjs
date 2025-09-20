#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PNPM_VERSION = "9.15.9";
const PNPM_LINUX_URL = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-x64`;
const FRONTEND_STANDALONE_CANDIDATES = [
  ".next/standalone/apps/frontend/server.js",
  ".next/standalone/server.js",
];

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

function syncDir(source, destination) {
  if (!existsSync(source)) {
    return;
  }

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function ensureEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || "production";
  const appPort =
    process.env.DATABRICKS_APP_PORT || process.env.FRONTEND_PORT || "12008";
  process.env.FRONTEND_PORT = appPort;
  process.env.PORT = appPort;
  if (!process.env.BACKEND_PORT) {
    const backendFallback = Number.parseInt(appPort, 10) + 1;
    process.env.BACKEND_PORT = backendFallback.toString();
  }
  process.env.HOST = process.env.HOST || "0.0.0.0";

  const databricksAppUrl = process.env.DATABRICKS_APP_URL;
  const resolvedAppUrl = databricksAppUrl
    ? databricksAppUrl.startsWith("http")
      ? databricksAppUrl
      : `https://${databricksAppUrl}`
    : `http://127.0.0.1:${process.env.FRONTEND_PORT}`;

  process.env.APP_URL = resolvedAppUrl;
  process.env.NEXT_PUBLIC_APP_URL = resolvedAppUrl;

  const pgVars = [
    `PGHOST=${process.env.PGHOST ?? "unset"}`,
    `PGPORT=${process.env.PGPORT ?? "unset"}`,
    `PGUSER=${process.env.PGUSER ?? "unset"}`,
    `PGDATABASE=${process.env.PGDATABASE ?? "unset"}`,
    `PGPASSWORD=${process.env.PGPASSWORD ? `len:${process.env.PGPASSWORD.length}` : "unset"}`,
    `PGSSLMODE=${process.env.PGSSLMODE ?? "unset"}`,
  ].join(", ");
  console.log(`[MetaMCP][Databricks] PG env status: ${pgVars}`);

  const dbxEnvKeys = Object.keys(process.env)
    .filter((key) => key.startsWith("DATABRICKS"))
    .join(",");
  console.log(`[MetaMCP][Databricks] Databricks env keys: ${dbxEnvKeys}`);

  if (process.env.PGHOST) {
    const user = encodeURIComponent(process.env.PGUSER || "");
    const password = encodeURIComponent(process.env.PGPASSWORD || "");
    const host = process.env.PGHOST;
    const port = process.env.PGPORT || "5432";
    const database = process.env.PGDATABASE || "postgres";
    const sslmode = process.env.PGSSLMODE ? `?sslmode=${process.env.PGSSLMODE}` : "";
    process.env.DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${database}${sslmode}`;
    console.log("[MetaMCP][Databricks] Derived DATABASE_URL for host", host);
  } else {
    console.log("[MetaMCP][Databricks] PGHOST not provided; using existing DATABASE_URL");
  }
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

function ensureBackendBundle(pnpmCommand, pnpmArgs) {
  const backendDir = path.join(repoRoot, "apps", "backend");
  const backendEntry = path.join(backendDir, "dist", "index.js");
  if (existsSync(backendEntry)) {
    return;
  }

  console.log(
    "[MetaMCP][Databricks] Backend bundle missing; running pnpm --filter backend run build",
  );
  const result = spawnSync(
    pnpmCommand,
    [...pnpmArgs, "--filter", "backend", "run", "build"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error("Failed to build backend bundle");
  }
}

function ensureFrontendBuild(frontendDir, pnpmCommand, pnpmArgs) {
  const nextBuildMarker = path.join(frontendDir, ".next", "BUILD_ID");
  if (existsSync(nextBuildMarker)) {
    return;
  }

  console.log(
    "[MetaMCP][Databricks] Frontend build artifacts missing; running pnpm --filter frontend run build",
  );
  const result = spawnSync(
    pnpmCommand,
    [...pnpmArgs, "--filter", "frontend", "run", "build"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error("Failed to build frontend bundle");
  }
}

function findStandaloneEntrypoint(frontendDir) {
  for (const candidate of FRONTEND_STANDALONE_CANDIDATES) {
    const absolute = path.join(frontendDir, candidate);
    if (existsSync(absolute)) {
      return candidate;
    }
  }
  return null;
}

function prepareStandaloneAssets(frontendDir, standaloneEntrypoint) {
  const standaloneDir = path.join(frontendDir, path.dirname(standaloneEntrypoint));
  const staticSource = path.join(frontendDir, ".next", "static");
  const staticDestination = path.join(standaloneDir, ".next", "static");
  syncDir(staticSource, staticDestination);

  const publicSource = path.join(frontendDir, "public");
  const publicDestination = path.join(standaloneDir, "public");
  syncDir(publicSource, publicDestination);
}

function runDatabaseMigrations(pnpmCommand, pnpmArgs) {
  console.log("[MetaMCP][Databricks] Applying database migrations");
  const result = spawnSync(
    pnpmCommand,
    [...pnpmArgs, "--filter", "backend", "exec", "drizzle-kit", "migrate"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error("Failed to apply database migrations");
  }
}

async function main() {
  await ensureDatabaseCredential();
  ensureEnv();

  const { command: pnpmCommand, args: pnpmArgs } = getPnpmCommand();

  ensureBackendBundle(pnpmCommand, pnpmArgs);
  runDatabaseMigrations(pnpmCommand, pnpmArgs);
  const backendEnv = {
    ...process.env,
    PORT: process.env.BACKEND_PORT,
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

  const frontendEnv = {
    ...process.env,
    PORT: process.env.FRONTEND_PORT,
  };
  const frontendDir = path.join(repoRoot, "apps", "frontend");
  ensureFrontendBuild(frontendDir, pnpmCommand, pnpmArgs);

  const standaloneEntrypoint = findStandaloneEntrypoint(frontendDir);

  let frontendCommand = pnpmCommand;
  let frontendArgs = [...pnpmArgs, "start"];

  if (standaloneEntrypoint) {
    prepareStandaloneAssets(frontendDir, standaloneEntrypoint);
    frontendCommand = "node";
    frontendArgs = [standaloneEntrypoint];
  }

  if (frontendCommand === "node") {
    console.log(`[MetaMCP][Databricks] Starting frontend via ${frontendArgs[0]}`);
  } else {
    console.log("[MetaMCP][Databricks] Starting frontend via pnpm start");
  }

  frontend = spawnService(
    "frontend",
    frontendCommand,
    frontendArgs,
    {
      cwd: frontendDir,
      env: frontendEnv,
    },
  );
}

main().catch((error) => {
  console.error("Failed to launch MetaMCP services", error);
  shutdown(1);
});

async function ensureDatabaseCredential() {
  if (!process.env.PGHOST) {
    console.warn("[MetaMCP][Databricks] PGHOST not set; skipping credential fetch");
    return;
  }

  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const baseUrl = process.env.DATABRICKS_HOST || process.env.DATABRICKS_APP_URL;

  if (!clientId || !clientSecret || !baseUrl) {
    console.warn("[MetaMCP][Databricks] Missing Databricks client credentials or host; using existing DATABASE_URL if provided", {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      baseUrl,
    });
    return;
  }

  try {
    const normalizedBase = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
    const tokenEndpoint = `${normalizedBase.replace(/\/$/, "")}/oidc/v1/token`;
    console.log("[MetaMCP][Databricks] Requesting workspace token", { tokenEndpoint });

    const tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "all-apis",
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.error("[MetaMCP][Databricks] Failed to fetch workspace OAuth token", tokenResponse.status, text);
      return;
    }

    const { access_token: workspaceToken } = await tokenResponse.json();
    if (!workspaceToken) {
      console.error("[MetaMCP][Databricks] Workspace OAuth response missing access_token");
      return;
    }

    const credentialEndpoint = `${normalizedBase.replace(/\/$/, "")}/api/2.0/database/credentials`;
    const instanceName = process.env.LAKEBASE_INSTANCE_NAME || process.env.PGHOST;
    const databaseName = process.env.LAKEBASE_DATABASE_NAME || process.env.PGDATABASE;

    const credentialPayload = {
      request_id: crypto.randomUUID(),
      instance_names: instanceName ? [instanceName] : undefined,
      database_names: databaseName ? [databaseName] : undefined,
    };

    console.log("[MetaMCP][Databricks] Requesting DB credential", {
      credentialEndpoint,
      instance: instanceName,
      database: databaseName,
    });

    const credentialResponse = await fetch(credentialEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workspaceToken}`,
      },
      body: JSON.stringify(credentialPayload),
    });

    if (!credentialResponse.ok) {
      const text = await credentialResponse.text();
      console.error("[MetaMCP][Databricks] Failed to generate database credential", credentialResponse.status, text);
      return;
    }

    const { token } = await credentialResponse.json();
    if (!token) {
      console.error("[MetaMCP][Databricks] Database credential response missing token");
      return;
    }

    process.env.PGPASSWORD = token;
    console.log("[MetaMCP][Databricks] Obtained database credential token (length)", token.length);
  } catch (err) {
    console.error("[MetaMCP][Databricks] Error fetching database credential", err);
  }
}
