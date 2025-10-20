# MCP Wrappers

This directory contains MCP (Model Context Protocol) wrappers for various services that require special setup or authentication.

## PostgreSQL MCP Wrapper

The PostgreSQL MCP wrapper provides access to PostgreSQL databases through Azure authentication and SSH tunneling.

### Files

- `postgres/postgres-mcp-wrapper.sh` - Generic PostgreSQL MCP wrapper
- `postgres/ox-staging-dwh.sh` - OceanX staging data warehouse specific configuration

### Prerequisites

1. **Azure CLI** - Required for Azure authentication
2. **SSH Client** - Required for SSH tunneling (included in Docker image)
3. **Azure Permissions** - Access to the PostgreSQL database

### Environment Variables

#### Required
- `POSTGRES_USER` - PostgreSQL username
- `POSTGRES_DB` - PostgreSQL database name

#### Optional
- `POSTGRES_HOST` - PostgreSQL host (default: localhost)
- `POSTGRES_PORT` - PostgreSQL port (default: 5432)
- `BASTION_HOST` - SSH bastion host for tunneling
- `BASTION_USER` - SSH bastion username
- `BASTION_PORT` - SSH bastion port (default: 22)
- `AZURE_ACCESS_TOKEN` - Azure access token (preferred method)
- `AZURE_TENANT_ID` - Azure tenant ID (for service principal auth)
- `AZURE_CLIENT_ID` - Azure client ID (for service principal auth)
- `AZURE_CLIENT_SECRET` - Azure client secret (for service principal auth)

### Usage

#### Generic Wrapper
```bash
export POSTGRES_USER="your_username"
export POSTGRES_DB="your_database"
export BASTION_HOST="your_bastion_host"
export BASTION_USER="your_bastion_user"
/usr/local/bin/postgres-mcp-wrapper
```

#### OceanX Staging DWH
```bash
# Step 1: Start local SSH tunnel (required)
ssh -f -N -L 0.0.0.0:5432:ox-stg-db-2.postgres.database.azure.com:5432 bastion@ox-stg-data-bastion-vm

# Step 2: Run the wrapper (pre-configured for OceanX staging environment)
/usr/local/bin/ox-staging-dwh
```

**Note:** The OceanX wrapper uses a local SSH tunnel approach where your local machine creates the SSH tunnel, and the Docker container connects through `host.docker.internal:5432`.

### Authentication

The wrapper supports three authentication methods (in order of preference):

1. **Pre-provided Access Token** (recommended)
   - Set `AZURE_ACCESS_TOKEN` environment variable
   - Get token locally: `./scripts/get-azure-token.sh`
   - Most secure and efficient method

2. **Service Principal Authentication**
   - Set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID`
   - Automatically authenticates using service principal

3. **Interactive Authentication** (fallback)
   - Run `az login` before starting the wrapper
   - Uses your current Azure session

### SSH Tunneling

The wrapper supports two SSH tunneling approaches:

#### 1. Automatic SSH Tunneling (Generic Wrapper)
If `BASTION_HOST` and `BASTION_USER` are provided, the wrapper will:
1. Create an SSH tunnel through the bastion host
2. Connect to PostgreSQL through the tunnel
3. Handle SSL certificate validation for tunneled connections

#### 2. Local SSH Tunnel (OceanX Wrapper)
The OceanX-specific wrapper uses a local SSH tunnel approach:
1. SSH tunnel runs on your local machine (outside Docker)
2. Docker container connects via `host.docker.internal:5432`
3. Allows the tunnel to persist across container restarts
4. Simpler setup for local development

**Setting up local SSH tunnel:**
```bash
# Run in background
ssh -f -N -L 0.0.0.0:5432:ox-stg-db-2.postgres.database.azure.com:5432 bastion@ox-stg-data-bastion-vm

# Check if tunnel is running
lsof -i :5432

# Kill tunnel if needed
pkill -f "ssh.*5432:ox-stg-db-2"
```

### Docker Integration

The wrappers are automatically installed in the MetaMCP Docker image and available at:
- `/usr/local/bin/postgres-mcp-wrapper` - Generic wrapper
- `/usr/local/bin/ox-staging-dwh` - OceanX specific wrapper

### Troubleshooting

1. **Azure CLI not found**
   - Ensure Azure CLI is installed in the container
   - Check that the Docker image was built with the custom Dockerfile

2. **Authentication failed**
   - Run `az login` to authenticate with Azure
   - Check your Azure permissions for the PostgreSQL database

3. **SSH tunnel failed**
   - Verify bastion host connectivity
   - Check SSH key authentication
   - Ensure the bastion host allows port forwarding

4. **Database connection failed**
   - Verify PostgreSQL host and port
   - Check database name and username
   - Ensure Azure access token has database permissions

5. **Local SSH tunnel issues (OceanX wrapper)**
   - Check if tunnel is running: `lsof -i :5432`
   - Verify tunnel listens on all interfaces (0.0.0.0, not just localhost)
   - Ensure Docker has `host.docker.internal` configured
   - Check for port conflicts on 5432

6. **SSL certificate errors**
   - The wrapper uses `sslmode=no-verify` for tunneled connections
   - This is expected when connecting through `host.docker.internal`
   - The real hostname (ox-stg-db-2.postgres.database.azure.com) won't match
   - Connection is still encrypted through SSL
