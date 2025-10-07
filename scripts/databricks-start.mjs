#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const wrapperRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const buildRoot = path.join(wrapperRoot, "build", "metamcp");
let repoRoot = buildRoot;
const PNPM_VERSION = "9.15.9";
const PNPM_LINUX_URL = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-x64`;
const UV_VERSION = "0.8.19";
const FRONTEND_STANDALONE_CANDIDATES = [
  ".next/standalone/apps/frontend/server.js",
  ".next/standalone/server.js",
];

function resolveNodeCommand() {
  if (process.env.NODE_BINARY && existsSync(process.env.NODE_BINARY)) {
    return process.env.NODE_BINARY;
  }

  if (existsSync("/usr/bin/node")) {
    return "/usr/bin/node";
  }

  return "node";
}

function ensureBuildTree(nodeCommand) {
  const packageJsonPath = path.join(buildRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    repoRoot = buildRoot;
    return;
  }

  console.log("[MetaMCP][Databricks] Preparing MetaMCP upstream tree");
  const prepareCmd =
    "METAMCP_REF=${METAMCP_REF:-} METAMCP_REPO_URL=${METAMCP_REPO_URL:-https://github.com/metatool-ai/metamcp.git} bash ./scripts/prepare-metamcp.sh";
  const prepareResult = spawnSync(
    "bash",
    ["-lc", prepareCmd],
    {
      cwd: wrapperRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
  if (prepareResult.status !== 0) {
    throw new Error("Failed to prepare MetaMCP tree");
  }

  console.log("[MetaMCP][Databricks] Building MetaMCP workspace");
  const buildResult = spawnSync(
    nodeCommand,
    ["build/metamcp/scripts/databricks-build.mjs"],
    {
      cwd: wrapperRoot,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (buildResult.status !== 0) {
    throw new Error("Failed to build MetaMCP workspace");
  }

  repoRoot = buildRoot;
}

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

function ensureUvCli() {
  const existing = spawnSync("uvx", ["--version"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  if (existing.status === 0) {
    console.log("[MetaMCP][Databricks] uvx already available");
    return;
  }

  console.log(`[MetaMCP][Databricks] Installing uv CLI via pip (uv==${UV_VERSION})`);

  const pipInstalled = installUvWithPip();

  if (!pipInstalled) {
    console.log(
      "[MetaMCP][Databricks] Pip installation failed; falling back to uv installer script",
    );
    installUvWithScript();
  }

  const verify = spawnSync("uvx", ["--version"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (verify.status !== 0) {
    throw new Error("uvx not available after pip installation");
  }
}

function installUvWithPip() {
  const install = spawnSync(
    "python3",
    ["-m", "pip", "install", "--no-cache-dir", `uv==${UV_VERSION}`],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
      },
    },
  );

  return install.status === 0;
}

function installUvWithScript() {
  const installDir = "/tmp/metamcp-uv";
  const script = spawnSync(
    "bash",
    [
      "-lc",
      "curl -LsSf https://astral.sh/uv/install.sh | sh",
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        UV_INSTALL_DIR: installDir,
      },
    },
  );

  if (script.status !== 0) {
    throw new Error("Failed to install uv via installer script");
  }

  if (process.env.PATH && !process.env.PATH.includes(installDir)) {
    process.env.PATH = `${installDir}:${process.env.PATH}`;
  }

  const bindir = `${installDir}/bin`;
  if (process.env.PATH && !process.env.PATH.includes(bindir)) {
    process.env.PATH = `${bindir}:${process.env.PATH}`;
  }
}

function ensureLinuxPnpm() {
  if (process.platform !== "linux") {
    return null;
  }

  const pnpmPath = path.join(repoRoot, "scripts", "pnpm-linuxstatic");
  if (!existsSync(pnpmPath)) {
    console.log(
      `[MetaMCP][Databricks] Downloading pnpm ${PNPM_VERSION} static binary`,
    );
    const download = spawnSync(
      "curl",
      ["-L", PNPM_LINUX_URL, "-o", pnpmPath],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );

    if (download.status !== 0) {
      throw new Error("Failed to download pnpm-linuxstatic");
    }

    chmodSync(pnpmPath, 0o755);
  }

  return pnpmPath;
}

function getPnpmCommand() {
  const pnpmStatic = ensureLinuxPnpm();
  if (pnpmStatic) {
    return { command: pnpmStatic, args: [] };
  }

  const pnpmLocal = spawnSync("pnpm", ["--version"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (pnpmLocal.status === 0) {
    return { command: "pnpm", args: [] };
  }

  const corepack = spawnSync("corepack", ["prepare", `pnpm@${PNPM_VERSION}`, "--activate"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (corepack.status === 0) {
    return { command: "pnpm", args: [] };
  }

  console.warn("[MetaMCP][Databricks] Falling back to npx pnpm; consider enabling corepack");
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

async function ensureCustomSchema() {
  console.log("[MetaMCP][Databricks] Ensuring custom schema exists");

  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pgPath = path.join(repoRoot, "apps", "backend", "node_modules", "pg");
  const pg = require(pgPath);

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("[MetaMCP][Databricks] Connected to database for schema setup");

    // Create custom schema if it doesn't exist
    await client.query(`CREATE SCHEMA IF NOT EXISTS metamcp_app`);
    console.log("[MetaMCP][Databricks] ✓ Schema 'metamcp_app' created/verified");

    // Set search_path to use custom schema by default
    await client.query(`SET search_path TO metamcp_app, public`);
    console.log("[MetaMCP][Databricks] ✓ Search path set to 'metamcp_app, public'");

  } catch (error) {
    console.error("[MetaMCP][Databricks] ❌ Failed to create schema:", error);
    throw error;
  } finally {
    await client.end();
  }
}

function runDatabaseMigrations(pnpmCommand, pnpmArgs) {
  console.log("[MetaMCP][Databricks] Applying database migrations");

  const result = spawnSync(
    pnpmCommand,
    [...pnpmArgs, "--filter", "backend", "exec", "drizzle-kit", "migrate"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        // Set PGOPTIONS to use custom schema for migrations
        PGOPTIONS: "-c search_path=metamcp_app,public",
      },
    },
  );

  if (result.status !== 0) {
    throw new Error("Failed to apply database migrations");
  }
}

async function main() {
  const nodeCommand = resolveNodeCommand();
  ensureBuildTree(nodeCommand);
  await ensureDatabaseCredential();
  ensureEnv();
  await ensureCustomSchema();
  ensureUvCli();

  const { command: pnpmCommand, args: pnpmArgs } = getPnpmCommand();

  ensureBackendBundle(pnpmCommand, pnpmArgs);
  runDatabaseMigrations(pnpmCommand, pnpmArgs);
  const backendEnv = {
    ...process.env,
    PORT: process.env.BACKEND_PORT,
    // Ensure backend uses custom schema
    PGOPTIONS: "-c search_path=metamcp_app,public",
  };

  backend = spawnService(
    "backend",
    nodeCommand,
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

  let frontendCommand = nodeCommand;
  let frontendArgs = [];

  if (standaloneEntrypoint) {
    prepareStandaloneAssets(frontendDir, standaloneEntrypoint);
    frontendArgs = [standaloneEntrypoint];
  } else {
    const nextBin = path.join(
      frontendDir,
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    );

    if (existsSync(nextBin)) {
      frontendArgs = [nextBin, "start"];
    } else {
      console.warn(
        "[MetaMCP][Databricks] next binary missing; falling back to pnpm start",
      );
      frontendCommand = pnpmCommand;
      frontendArgs = [...pnpmArgs, "start"];
    }
  }

  if (frontendCommand === nodeCommand) {
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
  console.log("[MetaMCP][Databricks] === Starting database credential fetch ===");

  if (!process.env.PGHOST) {
    throw new Error("PGHOST environment variable is not set - cannot fetch database credentials");
  }
  console.log("[MetaMCP][Databricks] ✓ PGHOST is set:", process.env.PGHOST);

  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const baseUrl = process.env.DATABRICKS_HOST || process.env.DATABRICKS_APP_URL;

  console.log("[MetaMCP][Databricks] Environment check:", {
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    hasBaseUrl: !!baseUrl,
    baseUrl: baseUrl || "NOT SET",
  });

  if (!clientId || !clientSecret || !baseUrl) {
    throw new Error(`Missing required Databricks credentials: clientId=${!!clientId}, clientSecret=${!!clientSecret}, baseUrl=${!!baseUrl}`);
  }

  try {
    const normalizedBase = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
    const tokenEndpoint = `${normalizedBase.replace(/\/$/, "")}/oidc/v1/token`;
    console.log("[MetaMCP][Databricks] Requesting workspace OAuth token from:", tokenEndpoint);

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
      throw new Error(`Failed to fetch workspace OAuth token: HTTP ${tokenResponse.status} - ${text}`);
    }

    const { access_token: workspaceToken } = await tokenResponse.json();
    if (!workspaceToken) {
      throw new Error("Workspace OAuth response missing access_token field");
    }
    console.log("[MetaMCP][Databricks] ✓ Successfully obtained workspace OAuth token");

    const credentialEndpoint = `${normalizedBase.replace(/\/$/, "")}/api/2.0/database/credentials`;
    const instanceName = process.env.LAKEBASE_INSTANCE_NAME || process.env.PGHOST;
    const databaseName = process.env.LAKEBASE_DATABASE_NAME || process.env.PGDATABASE;

    const credentialPayload = {
      request_id: crypto.randomUUID(),
      instance_names: instanceName ? [instanceName] : undefined,
    };

    console.log("[MetaMCP][Databricks] Requesting database credential from:", credentialEndpoint);
    console.log("[MetaMCP][Databricks] Payload:", JSON.stringify(credentialPayload, null, 2));

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
      throw new Error(`Failed to generate database credential: HTTP ${credentialResponse.status} - ${text}`);
    }

    const credentialData = await credentialResponse.json();
    console.log("[MetaMCP][Databricks] Database credential response keys:", Object.keys(credentialData));

    const { token } = credentialData;
    if (!token) {
      throw new Error(`Database credential response missing token field. Response: ${JSON.stringify(credentialData)}`);
    }

    process.env.PGPASSWORD = token;
    console.log("[MetaMCP][Databricks] ✓ Successfully set PGPASSWORD (token length:", token.length, ")");
    console.log("[MetaMCP][Databricks] === Database credential fetch completed successfully ===");
  } catch (err) {
    console.error("[MetaMCP][Databricks] ❌ FATAL ERROR in ensureDatabaseCredential:");
    console.error(err);
    throw err;
  }
}
