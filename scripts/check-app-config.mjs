#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const targetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("build", "metamcp", "app.yaml");

try {
  statSync(targetPath);
} catch (error) {
  console.error(`Unable to read app config at ${targetPath}: ${error.message}`);
  process.exit(1);
}

const contents = readFileSync(targetPath, "utf8");
const placeholderPattern = /\$\{[^}]+\}/g;
const matches = contents.match(placeholderPattern);
if (matches && matches.length > 0) {
  // Filter out Databricks Asset Bundle variables (${var.xxx}, ${resources.xxx}, ${env.xxx})
  const unresolved = matches.filter(match => {
    const content = match.slice(2, -1); // Remove ${ and }
    return !content.startsWith('var.') &&
           !content.startsWith('resources.') &&
           !content.startsWith('env.');
  });

  if (unresolved.length > 0) {
    const unique = [...new Set(unresolved)];
    console.error("Unresolved template placeholders detected in app.yaml:");
    for (const item of unique) {
      console.error(`  - ${item}`);
    }
    console.error(
      "Re-run scripts/render-app-config.mjs or inspect your environment variables.",
    );
    process.exit(1);
  }
}

const requiredStrings = [
  "runtime: nodejs22",
  "command:",
  "databricks-build.mjs",
  "databricks-start.mjs",
];
for (const needle of requiredStrings) {
  if (!contents.includes(needle)) {
    console.error(
      `Expected to find "${needle}" in ${targetPath} but it was missing.`,
    );
    process.exit(1);
  }
}

console.log(`app.yaml at ${targetPath} passed validation.`);
