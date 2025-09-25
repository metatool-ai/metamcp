# MetaMCP on Databricks

MetaMCP lets you orchestrate every Model Context Protocol (MCP) server through a single control plane. This wrapper repo packages the upstream MetaMCP release so Databricks teams can deploy it as a governed Databricks App with Databricks-native storage, security, and CI/CD.

```mermaid
flowchart LR
    subgraph Local Dev
        A[Wrapper Repo] --> B[make prepare]
        B --> C[make build]
    end
    C --> D[make bundle-deploy]
    subgraph Workspace
        D --> E[Databricks Asset Bundle]
        E --> F[Databricks App Snapshot]
        F --> G[MetaMCP Runtime (/metamcp/health)]
    end
    G --> H[Lakehouse Tables]
    G --> I[MCP Clients & Users]
```

## Quickstart
All commands run from the repo root.

1. **Authenticate once**
   ```bash
   databricks auth login --profile <PROFILE>
   ```
2. **Clone upstream & apply overrides**
   ```bash
   make prepare METAMCP_REF=v2.0.0
   ```
3. **Build inside the generated tree**
   ```bash
   make build
   ```
4. **Publish an Asset Bundle**
   ```bash
   make bundle-deploy TARGET=dev DATABRICKS_CONFIG_PROFILE=<PROFILE>
   ```
5. **Deploy the Databricks App**
   ```bash
   make app-deploy APP_NAME=metamcp TARGET=dev DATABRICKS_CONFIG_PROFILE=<PROFILE>
   ```
6. **Smoke test the runtime**
   ```bash
   make app-health APP_NAME=metamcp TARGET=dev DATABRICKS_CONFIG_PROFILE=<PROFILE>
   ```

## Preflight Checklist
- Databricks CLI v0.229.0+ is installed and logged in for the profile you plan to pass to `make`.
- Workspace has access to the Unity Catalog catalog/schema referenced in `.env`.
- Your `.env` (copied from `.env.template`) contains Lakehouse connection details and any upstream MetaMCP secrets.
- Outbound network access is permitted so the Databricks App can download `pnpm` and NPM packages during bootstrap.
- You are ready to re-clone: `build/metamcp` is disposable and regenerated on every `make prepare`.

## How This Project Works
- **MetaMCP upstream** – We always start from the official [MetaMCP repo](https://github.com/metatool-ai/metamcp) and documentation at [docs.metamcp.com](https://docs.metamcp.com). MetaMCP aggregates and proxies multiple MCP servers so you can expose a single MCP endpoint.
- **Databricks Asset Bundles** – `make bundle-deploy` packages this repo plus generated overrides into a Databricks Asset Bundle, providing infrastructure-as-code style deployment to workspaces. Learn more in [Databricks Asset Bundles docs](https://docs.databricks.com/aws/en/dev-tools/bundles).
- **Databricks Apps** – `make app-deploy` snapshots the bundle into a managed Databricks App that runs on serverless infrastructure with built-in auth and governance. See [What is Databricks Apps?](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/what-is).
- **Lakehouse integration** – MetaMCP persists configuration and session data to the Databricks Lakehouse (Unity Catalog tables). Ensure those schemas exist before the app starts so migrations succeed.
- **Bootstrap scripts** – `scripts/prepare-metamcp.sh` wipes and clones upstream, `scripts/databricks-build.mjs` installs dependencies and compiles, and `scripts/databricks-start.mjs` runs migrations before launching the server. Any permanent customization lives in this repo or an upstream fork referenced by `METAMCP_REPO_URL`.

## Deployment Environments & Upgrades
- Set `TARGET=<stage>` to map to the environments defined in `databricks.yml` (e.g., `dev`, `prod`). Each stage maintains its own bundle state in Databricks.
- Use descriptive app names (`APP_NAME=metamcp-prod`) so `app-status`, `app-logs`, and `app-health` target the correct deployment.
- Pin precise upstream versions by exporting `METAMCP_REF=<tag-or-commit>` in CI/CD. This guarantees reproducible bundles and makes rollbacks trivial.
- To upgrade MetaMCP:
  1. Update `METAMCP_REF` to the desired tag.
  2. Run `make prepare && make build` locally to confirm the build still succeeds.
  3. Deploy to a non-production target, validate `/metamcp/health`, then promote to production.
- When hotfixing an upstream issue, consider pointing `METAMCP_REPO_URL` to your fork. Once upstream releases the fix, revert back to `https://github.com/metatool-ai/metamcp.git` with a pinned tag.

## Operations Toolkit
- `make app-status APP_NAME=<name>` – Inspect the current Databricks App (returns JSON with URL, state, and bundle version).
- `make app-logs APP_NAME=<name>` – Stream live logs via the Databricks Apps log proxy.
- `make app-health APP_NAME=<name>` – Calls the live `/metamcp/health` endpoint through the app URL and prints the HTTP status.
- `make clean` – Delete `build/metamcp` to force a fresh `make prepare` run.

## CI/CD Recommendations
- Run `scripts/prepare-metamcp.sh` in every pipeline to guarantee a clean clone.
- Export `METAMCP_REF` in pipeline variables and record it in deployment logs for traceability.
- After `make app-deploy`, capture the Databricks App URL and hit `/metamcp/health` as a gating check.
- Store `.env` secrets in your secret manager and inject them at runtime; never commit them.

## Debug Guide
- **Health check fails** – Confirm the target URL includes the `/metamcp/health` prefix. The Databricks App proxy rewrites all traffic under `/metamcp`.
- **Bundle path missing** – Run `make bundle-deploy` immediately before `make app-deploy` for the same `TARGET`; the deploy script aborts early if no bundle summary is available.
- **Build errors about pnpm** – Ensure the workspace allows outbound download of the pinned pnpm binary. If egress is blocked, pre-stage the binary and adjust `databricks-build.mjs` to point to your mirror.
- **Database migration warnings** – If logs mention missing tables (for example `docker_sessions`), run the migrations locally or let the Databricks App create them on first boot once the catalog and schema exist.
- **Stale upstream code** – Re-run `make prepare` any time you change branches or bump `METAMCP_REF`; the script is destructive by design.

## Additional Resources
- MetaMCP landing page: https://metamcp.com/
- MetaMCP documentation: https://docs.metamcp.com/
- Databricks Apps product page: https://www.databricks.com/product/databricks-apps
- Databricks Asset Bundles overview: https://docs.databricks.com/aws/en/dev-tools/bundles

