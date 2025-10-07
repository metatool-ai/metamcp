# MetaMCP Databricks Deployment Status (2025-09-30 SOLUTION)

## BREAKTHROUGH: Understanding Lakebase + Databricks Apps Integration

### How It Actually Works

**Lakebase Resource Auto-Injected Variables:**
- `PGHOST` - Database hostname
- `PGPORT` - Database port
- `PGDATABASE` - Database name
- `PGUSER` - Service principal client ID (for auth)
- `PGSSLMODE` - SSL mode
- `PGAPPNAME` - App name
- **NOT INJECTED: `PGPASSWORD`** ⚠️

**Databricks Apps Auto-Injected Variables:**
- `DATABRICKS_HOST` - Workspace URL
- `DATABRICKS_CLIENT_ID` - Service principal client ID
- `DATABRICKS_CLIENT_SECRET` - OAuth secret
- `DATABRICKS_APP_PORT` - App port
- `DATABRICKS_APP_NAME` - App name
- `DATABRICKS_WORKSPACE_ID` - Workspace ID

### The Password Problem & Solution

**The Issue:**
- Lakebase doesn't provide `PGPASSWORD` directly
- Password must be fetched dynamically using OAuth
- databricks-start.mjs already implements this! (lines 492-582)

**The Flow:**
1. Lakebase resource injects `PGHOST`, `PGPORT`, etc.
2. Databricks Apps inject `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_HOST`
3. databricks-start.mjs:
   - Detects `PGHOST` is set
   - Uses OAuth credentials to fetch database token from `/oidc/v1/token`
   - Uses that token to get database password from `/api/2.0/database/credentials`
   - Sets `PGPASSWORD`
   - Builds `DATABASE_URL` from all PG* variables

**The Fix:**
- REMOVED `valueFrom: lakebase` from DATABASE_URL in app.yaml
- Let databricks-start.mjs handle DATABASE_URL construction
- The script already has all the logic needed!

## Current Configuration

### app.yaml (Fixed)
```yaml
env:
  # DATABASE_URL is built dynamically by databricks-start.mjs from:
  # - PGHOST, PGPORT, PGDATABASE, PGUSER, PGSSLMODE (from Lakebase resource)
  # - PGPASSWORD (fetched via OAuth using DATABRICKS_CLIENT_ID/SECRET)
  - name: BETTER_AUTH_SECRET
    value: ${BETTER_AUTH_SECRET}
  - name: LAKEBASE_INSTANCE_NAME
    value: ${LAKEBASE_INSTANCE_NAME}
  - name: LAKEBASE_DATABASE_NAME
    value: ${LAKEBASE_DATABASE_NAME}
```

### databricks.yml (Working)
```yaml
resources:
  database_instances:
    metamcp_lakebase:
      name: metamcp
      capacity: CU_1
      enable_pg_native_login: true

  apps:
    metamcp_app:
      name: metamcp
      resources:
        - name: lakebase
          database:
            instance_name: metamcp
            database_name: metamcp_app
            permission: CAN_CONNECT_AND_CREATE
```

## What Was Wrong Before

**Previous Attempt:**
```yaml
- name: DATABASE_URL
  valueFrom: lakebase  # ❌ This was setting DATABASE_URL incorrectly
```

**Problem:**
- `valueFrom: lakebase` may have been setting DATABASE_URL to a partial/incorrect value
- This prevented databricks-start.mjs from building it properly
- The script logs showed it was using "existing DATABASE_URL" instead of building it

## Expected Behavior (After Fix)

### Startup Logs Should Show:
```
[MetaMCP][Databricks] PG env status: PGHOST=..., PGPORT=5432, PGUSER=..., PGDATABASE=metamcp_app, PGPASSWORD=len:XXX, PGSSLMODE=...
[MetaMCP][Databricks] Databricks env keys: DATABRICKS_HOST,DATABRICKS_CLIENT_ID,DATABRICKS_CLIENT_SECRET,...
[MetaMCP][Databricks] Requesting workspace token { tokenEndpoint: 'https://.../.../oidc/v1/token' }
[MetaMCP][Databricks] Requesting DB credential { ... instance: 'metamcp', database: 'metamcp_app' }
[MetaMCP][Databricks] Obtained database credential token (length) XXX
[MetaMCP][Databricks] Derived DATABASE_URL for host XXX
[MetaMCP][Databricks] Applying database migrations
```

### Health Check Should Return:
```
HTTP 200 OK
{ "status": "ok" }
```

## Deployment Commands

```bash
# Clean redeploy with fixed configuration
make clean
make deploy

# Check app status
databricks apps get metamcp --profile DEFAULT --output json | jq '.app_status'

# Test health
make health
```

## Key Learnings

1. **Lakebase doesn't inject PGPASSWORD** - must be fetched via OAuth
2. **databricks-start.mjs already implements OAuth password fetch** - just needed proper env setup
3. **valueFrom: lakebase is for hostname/connection details, not full DATABASE_URL**
4. **Let the app build DATABASE_URL** - don't try to set it via valueFrom
5. **All required credentials are auto-injected** - just let the flow work

## References

- [Databricks Apps Lakebase Docs](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase)
- [Databricks Apps System Environment](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/system-env)
- [Databricks Apps Authorization](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth)

## App URL
https://metamcp-3664367183993915.aws.databricksapps.com
