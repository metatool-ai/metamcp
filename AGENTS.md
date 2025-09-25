# Databricks Agent Runbook

## Purpose
This repository wraps the upstream MetaMCP release so we can ship a Databricks App that stays faithful to upstream while layering Databricks-specific overrides. Every deploy begins from a clean MetaMCP checkout under `build/metamcp`, so the only content we commit here is the automation and configuration needed to launch it inside Databricks.

## Golden Deployment Path
1. **Authenticate** – Ensure `databricks auth login` has been run for the profile you will pass via `DATABRICKS_CONFIG_PROFILE`.
2. **Prepare sources** – `make prepare METAMCP_REF=<tag-or-commit>` clones the requested MetaMCP release to `build/metamcp` and overlays our scripts (`scripts/`), Databricks bundle (`databricks.yml`), and `.env.template`. Re-run this whenever you change `METAMCP_REF` or update overrides locally.
3. **Build with overrides** – `make build` executes `node build/metamcp/scripts/databricks-build.mjs`, installing dependencies with the patched workspace layout so `pnpm` works outside MetaMCP's monorepo. If you need a clean slate, remove `build/metamcp/node_modules` first.
4. **Publish bundle** – `make bundle-deploy TARGET=<env>` pushes the Databricks Asset Bundle described in `databricks.yml`. The bundle path is written to the workspace and later reused by the app deploy step.
5. **Deploy the app** – `make app-deploy APP_NAME=<app>` snapshots the bundle into a Databricks App (`--mode SNAPSHOT`). This target implicitly checks for a prior bundle deploy and fails fast with guidance if one is missing.
6. **Verify health** – `make app-health APP_NAME=<app>` authenticates with the Databricks Apps proxy and calls `/metamcp/health`, the health endpoint exposed by the upstream server when mounted behind our path prefix. Older `/api/health` checks 404 because the proxy rewrites requests; keep this distinction in mind when debugging.

## How the Bootstrap Works
- `scripts/prepare-metamcp.sh` wipes `build/metamcp`, performs a shallow clone of MetaMCP (optionally pinned by `METAMCP_REF`), and applies Databricks overrides. It is intentionally destructive so every run starts from a known state.
- `databricks-build.mjs` downloads the upstream `pnpm` binary, installs dependencies inside the generated workspace, and runs the MetaMCP build with our overrides in place.
- `databricks-start.mjs` (invoked by the Databricks App) sets runtime environment variables, runs migrations via `pnpm exec drizzle-kit migrate`, then launches the MetaMCP server within the Databricks Apps container.

Understanding these scripts is critical: any local edits under `build/metamcp` are lost on the next prepare, so permanent changes must live in our wrapper repo or an upstream fork.

## Observability & Operations
- **Health checks** – Always target `/metamcp/health`. The Databricks Apps reverse proxy injects `/metamcp` as the base path.
- **Logs** – `make app-logs` streams application logs through the Databricks Apps log endpoint. If you need deeper history, open the App in the Databricks UI and inspect the Log Analytics integration.
- **State** – MetaMCP persists via the Lakehouse tables configured in `.env`. Ensure the workspace has access to the catalog/schema before bootstrapping. Missing tables (e.g., `docker_sessions`) log warnings but do not block the app; run the bundled migrations to create them.

## Common Pitfalls & Fixes
- **Forgetting to rerun prepare** – Symptoms: outdated code, missing overrides. Fix: rerun `make prepare` whenever you change branches or bump `METAMCP_REF`.
- **Stale bundle path** – Symptoms: `make app-deploy` fails to resolve `BUNDLE_PATH`. Fix: run `make bundle-deploy` for the same `TARGET` before deploying the app.
- **Health check 404** – Cause: hitting `/api/health` instead of `/metamcp/health`. Fix: use the updated `app-health` target or manually include the prefix.
- **Workspace build noise** – Logs may complain about missing optional tables (e.g., `docker_sessions`). Run migrations with the Databricks App’s environment variables to create them or suppress by creating empty tables.

## CI/CD Checklist
- Run `scripts/prepare-metamcp.sh` with `METAMCP_REF` pinned to a released tag so every pipeline run is reproducible.
- Upload `.env.template` to your secret manager and inject environment variables as part of the pipeline before `make bundle-deploy`.
- After deployment, call the `/metamcp/health` endpoint and surface failures in your pipeline status to catch regressions quickly.

## When to Upstream vs. Override
If you need to modify MetaMCP source code, contribute the change upstream or maintain a fork referenced by `METAMCP_REPO_URL`. Reserve wrapper changes for automation, Databricks configuration, or environment wiring so our repo stays thin and easy to audit.
