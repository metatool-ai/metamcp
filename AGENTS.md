# Repository Guidelines

## Upstream Sync Workflow
- Run `scripts/prepare-metamcp.sh` to clone the latest MetaMCP release into `build/metamcp`. Set `METAMCP_REF=<tag-or-commit>` to pin a specific revision.
- The script overlays Databricks-specific assets (custom `scripts/`, `databricks.yml`, `.env.template`) and rewrites internal workspaces so `pnpm` installs succeed outside of the original monorepo.
- All generated assets live under `build/`; a subsequent run wipes and repopulates the directory, so never commit its contents.

## Local Build & Smoke Test
- After preparing the tree, run `node build/metamcp/scripts/databricks-build.mjs` to install dependencies and build the upstream app with the Databricks overrides.
- To spot-check the runtime, use `pnpm --dir build/metamcp -- filter @repo/app start` or bring up the Docker Compose stack that ships with the upstream release directly from `build/metamcp`.
- Clean up with `rm -rf build/metamcp/node_modules` when you need a fresh install.

## Databricks Deployment Flow
- `databricks.yml` points the bundle to `build/metamcp`, so ensure the prepare script has been run immediately before `databricks bundle deploy`.
- Configure credentials in `.env` (copied from `.env.template`) prior to deploying; the Databricks CLI picks them up automatically.
- For CI/CD, add a step that runs `scripts/prepare-metamcp.sh` (with your chosen `METAMCP_REF`) before invoking any bundle commands, so every deploy snapshots an explicit upstream release.

## Repository Layout
- Only keep wrapper assets here: environment templates, Databricks bundle config, and the prep/override scripts.
- All upstream source code is fetched on demand; if you find yourself editing files under `build/metamcp`, upstream those changes or add a scripted override.
