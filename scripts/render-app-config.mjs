#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const buildDir = process.argv[2];
if (!buildDir) {
  console.error("Usage: node scripts/render-app-config.mjs <build-dir>");
  process.exit(1);
}

const templatePath = path.resolve("app.yaml");
const outputPath = path.resolve(buildDir, "app.yaml");
const template = readFileSync(templatePath, "utf8");
const missing = new Set();

const envVars = new Map(Object.entries(process.env));
let envFileLoaded = false;

const maybeLoadEnvFile = () => {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed;
    const [key, ...rest] = normalized.split("=");
    if (!key) continue;
    const value = rest.join("=");
    if (value === undefined) continue;
    const strippedLeading = value.replace(/^[\s]+/, "");
    const finalValue = strippedLeading.replace(/^['"](.+)['"]$/, "$1");
    const existing = envVars.get(key);
    if (existing !== undefined && existing !== "") continue;
    envVars.set(key, finalValue);
  }
};

const resolveVar = (name) => {
  let value = envVars.get(name);
  if (value === undefined || value === "") {
    maybeLoadEnvFile();
    value = envVars.get(name);
  }
  if (value === undefined || value === "") return undefined;
  return value;
};

const evaluateParameter = (raw) => {
  const paramMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?::([-=?+])(.*))?$/);
  if (!paramMatch) {
    const value = resolveVar(raw);
    return value === undefined
      ? { missingKey: raw }
      : { value };
  }

  const [, varName, operator, remainder = ""] = paramMatch;
  const fallback = remainder.startsWith(" ") ? remainder.slice(1) : remainder;
  const value = resolveVar(varName);

  if (!operator) {
    return value === undefined
      ? { missingKey: varName }
      : { value };
  }

  switch (operator) {
    case "-":
    case "=":
      if (value === undefined) return { value: fallback };
      return { value };
    case "+":
      if (value === undefined) return { value: "" };
      return { value: fallback };
    case "?":
      if (value === undefined) {
        const message = fallback || `Missing required environment variable: ${varName}`;
        return { errorKey: `${varName}:?${fallback}`, message };
      }
      return { value };
    default:
      return value === undefined
        ? { missingKey: varName }
        : { value };
  }
};

const rendered = template.replace(/\$\{([^}]+)\}/g, (match, raw) => {
  // Pass through Databricks Asset Bundle variables unchanged (e.g., ${var.xxx}, ${resources.xxx})
  if (raw.startsWith('var.') || raw.startsWith('resources.') || raw.startsWith('env.')) {
    return match;
  }

  const result = evaluateParameter(raw);
  if (result.value !== undefined) {
    return result.value;
  }
  if (result.errorKey) {
    missing.add(result.errorKey);
    return match;
  }
  if (result.missingKey) {
    missing.add(result.missingKey);
  }
  return match;
});

if (missing.size > 0) {
  console.error(
    "Missing environment variables in app.yaml template:",
    Array.from(missing).join(", "),
  );
  process.exit(1);
}

writeFileSync(outputPath, rendered, "utf8");
