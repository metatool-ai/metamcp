# MetaMCP Databricks Deployment - Troubleshooting Guide

## Current Status (2025-10-01)

### ✅ What's Working
- Build system: MetaMCP v2.0.0 clones and builds successfully
- Bundle deployment: Database instance "metamcp" created
- App deployment: App "metamcp" created and deployed
- Resource configuration: Lakebase resource properly attached
- App reports status: "RUNNING"

### ❌ What's Not Working
- **All HTTP endpoints return 502 Bad Gateway**
- App containers are not responding to requests
- Most likely: Database connection/migration failing during startup

## Root Cause Analysis

### Environment Variables (Confirmed Auto-Injected)

**From Lakebase Resource:**
```bash
PGHOST=<lakebase-hostname>
PGPORT=5432
PGDATABASE=metamcp_app
PGUSER=<service-principal-client-id>
PGSSLMODE=<ssl-mode>
PGAPPNAME=metamcp
```

**From Databricks Apps:**
```bash
DATABRICKS_HOST=<workspace-url>
DATABRICKS_CLIENT_ID=<service-principal-client-id>
DATABRICKS_CLIENT_SECRET=<oauth-secret>
DATABRICKS_APP_PORT=8000
DATABRICKS_APP_NAME=metamcp
DATABRICKS_WORKSPACE_ID=<workspace-id>
```

**Missing:** `PGPASSWORD` - must be fetched via OAuth

### The OAuth Credential Fetch Flow

The databricks-start.mjs script (lines 492-582) implements:

1. **Check for PGHOST** - if not set, skip credential fetch
2. **Get workspace OAuth token** from `${DATABRICKS_HOST}/oidc/v1/token`
   - Uses `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET`
   - Grant type: `client_credentials`
   - Scope: `all-apis`
3. **Get database credential** from `${DATABRICKS_HOST}/api/2.0/database/credentials`
   - Uses workspace token from step 2
   - Payload: `{ request_id, instance_names: [instanceName] }`
4. **Set PGPASSWORD** from returned token
5. **Build DATABASE_URL** from all PG* variables

### Why It's Failing (Hypothesis)

Without access to logs, the most likely failure points are:

1. **OAuth token endpoint failing** (step 2)
   - Wrong endpoint path?
   - Auth credentials not working?

2. **Database credential endpoint failing** (step 3)
   - Wrong endpoint path (`/api/2.0/database/credentials` not confirmed)
   - Wrong payload format?
   - Service principal lacks permissions?

3. **Password format issues** (step 4-5)
   - Token returned but in wrong format?
   - DATABASE_URL construction failing?

## Critical Next Steps (NEED LOGS!)

### 1. Access App Logs

The app startup logs will show exactly where it's failing. To access:

**Via Databricks UI:**
1. Go to Databricks workspace
2. Navigate to Apps
3. Click on "metamcp" app
4. Go to "Logs" or "Environment" tab

**Via API (if log streaming works):**
```bash
APP_URL=$(databricks apps get metamcp --profile DEFAULT --output json | jq -r .url)
ACCESS_TOKEN=$(databricks auth token --profile DEFAULT --output json | jq -r .access_token)
curl -N -H "Authorization: Bearer $ACCESS_TOKEN" "$APP_URL/logz/stream"
```

### 2. Look for These Log Messages

**Success Flow:**
```
[MetaMCP][Databricks] PG env status: PGHOST=..., PGPASSWORD=len:XXX
[MetaMCP][Databricks] Databricks env keys: DATABRICKS_HOST,DATABRICKS_CLIENT_ID,...
[MetaMCP][Databricks] Requesting workspace token { tokenEndpoint: '...' }
[MetaMCP][Databricks] Requesting DB credential { ... instance: 'metamcp' }
[MetaMCP][Databricks] Obtained database credential token (length) XXX
[MetaMCP][Databricks] Derived DATABASE_URL for host XXX
[MetaMCP][Databricks] Applying database migrations
```

**Failure Indicators:**
```
[MetaMCP][Databricks] PGHOST not set
[MetaMCP][Databricks] Missing Databricks client credentials
[MetaMCP][Databricks] Failed to fetch workspace OAuth token
[MetaMCP][Databricks] Failed to generate database credential
[MetaMCP][Databricks] Database credential response missing token
[MetaMCP][Databricks] Error fetching database credential
Failed to apply database migrations
```

### 3. Manual Testing

Test the OAuth flow manually to isolate the issue:

```bash
# Get app details
databricks apps get metamcp --profile DEFAULT --output json > app.json
cat app.json | jq '{
  service_principal_client_id,
  resources
}'

# The service_principal_client_id should match DATABRICKS_CLIENT_ID
# Try to manually generate database credential
databricks database generate-database-credential \
  --request-id $(uuidgen) \
  --json '{"instance_names": ["metamcp"]}' \
  --profile DEFAULT
```

If this works, the credential is being generated correctly. If it fails, check:
- Service principal permissions
- Database instance name
- Workspace configuration

### 4. Simplified Debugging Approach

Create a minimal test to isolate the database connection:

**Option A: Simple Health Check Script**
Add a basic HTTP server that returns environment variables (masked):

```javascript
// Add to databricks-start.mjs before main()
import http from 'http';

const debugServer = http.createServer((req, res) => {
  if (req.url === '/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      has_pghost: !!process.env.PGHOST,
      has_pgpassword: !!process.env.PGPASSWORD,
      has_databricks_client_id: !!process.env.DATABRICKS_CLIENT_ID,
      has_databricks_client_secret: !!process.env.DATABRICKS_CLIENT_SECRET,
      has_databricks_host: !!process.env.DATABRICKS_HOST,
      pghost_value: process.env.PGHOST,
      databricks_host_value: process.env.DATABRICKS_HOST,
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

debugServer.listen(12008, '0.0.0.0', () => {
  console.log('Debug server listening on 12008');
});
```

Deploy this and check `/debug` endpoint to see what env vars are actually set.

**Option B: Test OAuth Flow Directly**
Create a standalone script that just tests the OAuth credential fetch:

```javascript
// test-oauth.mjs
const clientId = process.env.DATABRICKS_CLIENT_ID;
const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
const host = process.env.DATABRICKS_HOST;

console.log('Testing OAuth flow...');
console.log('Client ID:', clientId?.substring(0, 8) + '...');
console.log('Host:', host);

// ... rest of OAuth logic ...
```

## Alternative Approaches

If OAuth credential fetch continues to fail:

### Option 1: Use Service Principal PAT
Instead of OAuth, generate a Personal Access Token for the service principal and use it directly.

### Option 2: External Database
Use an external PostgreSQL database instead of Lakebase:
- Set up RDS/Cloud SQL/etc
- Provide DATABASE_URL directly in app.yaml
- Bypass all OAuth complexity

### Option 3: Pre-provision Credentials
Manually generate database credentials and store in Databricks Secrets:
```bash
# Generate credential
TOKEN=$(databricks database generate-database-credential \
  --request-id $(uuidgen) \
  --json '{"instance_names": ["metamcp"]}' \
  --profile DEFAULT | jq -r .token)

# Store in secret scope
databricks secrets put-secret metamcp PGPASSWORD --string-value "$TOKEN"

# Reference in app.yaml
env:
  - name: PGPASSWORD
    valueFrom: secret/metamcp/PGPASSWORD
```

## Files Modified in This Session

### app.yaml
- Removed `valueFrom: lakebase` for DATABASE_URL
- Now relies on databricks-start.mjs to build DATABASE_URL from PG* vars

### databricks.yml
- Removed invalid `depends_on` field
- Lakebase resource properly configured

### scripts/databricks-start.mjs
- Removed `database_names` parameter from credential API call
- OAuth flow should work with just `instance_names`

## Key Learnings

1. **Lakebase resources auto-inject PG* variables** (except PGPASSWORD)
2. **Databricks Apps auto-inject DATABRICKS_* OAuth credentials**
3. **PGPASSWORD must be fetched via OAuth at runtime**
4. **databricks-start.mjs already implements this** - just needs correct environment
5. **Can't debug without logs** - 502 errors give no insight into root cause

## App Details

- **URL**: https://metamcp-3664367183993915.aws.databricksapps.com
- **Database Instance**: metamcp
- **Database Name**: metamcp_app
- **Bundle Path**: /Workspace/Users/randy.pitcher@databricks.com/.bundle/metamcp/prod

## Next Session Checklist

- [ ] Access app logs via Databricks UI
- [ ] Identify exact error message
- [ ] Verify all environment variables are set
- [ ] Test manual database credential generation
- [ ] If OAuth fails, try alternative approaches above
