#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const targetRoot = process.argv[2];

if (!targetRoot) {
  console.error("Usage: node scripts/apply-databricks-overrides.mjs <target-root>");
  process.exit(1);
}

const PNPM_VERSION = "9.15.9";

function readJson(relativePath) {
  const filePath = path.join(targetRoot, relativePath);
  return {
    filePath,
    data: JSON.parse(readFileSync(filePath, "utf8")),
  };
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function applyRootPackageOverrides() {
  const { filePath, data } = readJson("package.json");
  data.scripts = data.scripts || {};
  data.scripts["build:turbo"] = "turbo run build";
  data.scripts.build = "node scripts/databricks-build.mjs";

  data.packageManager = `pnpm@${PNPM_VERSION}`;

  writeJson(filePath, data);
}

function rewriteWorkspaceDeps(relativePath, replacements) {
  const { filePath, data } = readJson(relativePath);
  const applyReplacements = (section) => {
    if (!data[section]) return;
    for (const [pkg, replacement] of Object.entries(replacements)) {
      if (data[section][pkg]) {
        data[section][pkg] = replacement;
      }
    }
  };

  applyReplacements("dependencies");
  applyReplacements("devDependencies");

  writeJson(filePath, data);
}

function patchLockfile() {
  const lockPath = path.join(targetRoot, "pnpm-lock.yaml");
  let text = readFileSync(lockPath, "utf8");
  const replacements = {
    "@repo/trpc": "file:../../packages/trpc",
    "@repo/zod-types": "file:../../packages/zod-types",
    "@repo/eslint-config": "file:../../packages/eslint-config",
    "@repo/typescript-config": "file:../../packages/typescript-config",
  };

  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let replacementsApplied = 0;
  for (const [pkg, replacement] of Object.entries(replacements)) {
    const pattern = new RegExp(
      `('${escapeRegex(pkg)}'\\s*:\\s*\\n\\s*specifier:\\s*)(workspace:\\*)`,
      "g",
    );
    text = text.replace(pattern, (_match, prefix) => {
      replacementsApplied += 1;
      return `${prefix}${replacement}`;
    });
  }

  if (process.env.DEBUG_PREPARE) {
    console.log(`[patchLockfile] replacements applied: ${replacementsApplied}`);
  }

  writeFileSync(lockPath, text, "utf8");
}

applyRootPackageOverrides();

rewriteWorkspaceDeps("apps/backend/package.json", {
  "@repo/trpc": "file:../../packages/trpc",
  "@repo/zod-types": "file:../../packages/zod-types",
  "@repo/eslint-config": "file:../../packages/eslint-config",
});

patchLockfile();

rewriteWorkspaceDeps("apps/frontend/package.json", {
  "@repo/trpc": "file:../../packages/trpc",
  "@repo/zod-types": "file:../../packages/zod-types",
  "@repo/eslint-config": "file:../../packages/eslint-config",
  "@repo/typescript-config": "file:../../packages/typescript-config",
});

rewriteWorkspaceDeps("packages/trpc/package.json", {
  "@repo/zod-types": "file:../../packages/zod-types",
  "@repo/eslint-config": "file:../../packages/eslint-config",
  "@repo/typescript-config": "file:../../packages/typescript-config",
});

rewriteWorkspaceDeps("packages/zod-types/package.json", {
  "@repo/eslint-config": "file:../../packages/eslint-config",
  "@repo/typescript-config": "file:../../packages/typescript-config",
});
