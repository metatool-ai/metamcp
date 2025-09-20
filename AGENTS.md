# Repository Guidelines

## Project Structure & Module Organization
The root directory stays lean: `docker-compose.yml` orchestrates the MetaMCP application and Postgres, while `example.env` documents every runtime variable. Copy it to `.env` for local overrides; Compose reads it automatically. Postgres persistence is handled by the `metamcp_postgres_data` volume declared in the compose file, so no additional directories are required.

## Build, Test, and Development Commands
- `cp example.env .env`: start from the published defaults without checking secrets into Git.
- `docker compose up --detach`: pull the `ghcr.io/metatool-ai/metamcp:latest` image, start both services, and wait for the Postgres health check.
- `docker compose logs -f app`: stream application output to confirm database setup and authentication wiring.
- `docker compose exec app bash`: open a shell in the running container for debugging or data seeding.
- `docker compose down -v`: stop everything and drop the Postgres volume when you need a reset.

## Coding Style & Naming Conventions
Indent YAML with two spaces and group related keys (service settings, environment variables, ports) to mirror the existing compose file. Add new configuration in uppercase `SNAKE_CASE`, describe it briefly in `example.env`, and keep comments crisp. Prefer descriptive service names and reuse the shared `metamcp-network` bridge unless isolation is required.

## Testing Guidelines
After configuration changes, cycle the stack (`docker compose down && docker compose up --detach`) and confirm both services report `healthy` via `docker compose ps`. Review logs for connection errors, then hit `http://localhost:12008` or run a smoke check from inside the container (`docker compose exec app curl -f localhost:12008/api/health`) before submitting changes.

## Commit & Pull Request Guidelines
Match the current history: write present-tense summaries around 60 characters (e.g., `provide better volume name for pg`) and add body text only when more context is needed. In pull requests, describe the scenario, call out new environment variables, and include validation evidence such as log excerpts or curl output. Link any related issues and flag breaking changes so reviewers can plan deploy sequencing.

## Security & Configuration Tips
Never commit populated `.env` files; rely on `example.env` for safe defaults and keep real secrets in local overrides or a vault. Rotate `BETTER_AUTH_SECRET` and database credentials before production use. When enabling OIDC, configure the provider values in `.env` and verify callback URLs match `APP_URL` to avoid leaking credentials.

## Databricks App Workflow
- Authenticate the CLI once with `databricks auth login --host <workspace-url>`.
- Copy `.env.template` to `.env`, then populate `DBX_HOST`, `DBX_USER`, and any overrides (`TARGET`, `APP_NAME`). The Makefile auto-loads variables from `.env`.
- (Optional) export overrides in your shell if you don't want them persisted in `.env`.
- Build and deploy:
  - `make build`: runs the Databricks build script and prepares the standalone Next.js assets.
  - `make bundle-deploy`: `databricks bundle deploy --target dev` to provision the Lakebase instance/catalog and register the app.
  - `make app-deploy`: snapshot deploy the code to the app with `databricks apps deploy`.
- Quick status checks live in the CLI: `make app-status` (or `databricks apps list`) and, if needed, `curl -H "Authorization: Bearer $(databricks auth token --output json | jq -r .access_token)" https://<app-host>/logz/stream` for live logs.

## Runtime Notes
- `scripts/databricks-start.mjs` now derives `APP_URL`/`NEXT_PUBLIC_APP_URL` from `DATABRICKS_APP_URL` and copies `apps/frontend/.next/static` plus `public/` into the standalone directory before booting the Next.js server, preventing 404s for bundled assets.
- The same script fetches a Lakebase credential token via the Databricks API; make sure the app service principal has database privileges (granted once via `psql`) so migrations succeed on startup.
- `scripts/databricks-build.mjs` mirrors the runtime URL logic so the prerendered HTML embeds the Databricks domain instead of `localhost`.

## Handy Make Targets
- `make install` — run `npm install` (writes `package-lock.json` for the Databricks build pipeline).
- `make build` — full pnpm build used by both local and remote deployments.
- `make bundle-deploy` — apply Terraform resources in `databricks.yml` to the `TARGET` environment (default `dev`).
- `make app-deploy` — push the latest workspace snapshot to `APP_NAME` (default `metamcp-app`). Requires `DBX_USER`.
- `make app-status` — dump `databricks apps get` JSON for the active deployment.
- `make app-logs` — stream recent deployment information and logs (requires `DBX_USER` and CLI auth).
- `make app-health` — call the `/api/health` endpoint through the Databricks app URL using a fresh workspace token.
