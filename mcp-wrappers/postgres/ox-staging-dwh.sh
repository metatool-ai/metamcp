#!/usr/bin/env bash
set -eE

# OceanX Staging Data Warehouse PostgreSQL MCP Wrapper
# Pre-configured for OceanX staging environment

# Set OceanX-specific environment variables for local SSH tunnel connection
# Since the local machine is already connected to SSH tunnel, connect to host.docker.internal
export POSTGRES_HOST="host.docker.internal"
export POSTGRES_PORT="5432"
export POSTGRES_USER="stg_dwh_user_reader"
export POSTGRES_DB="data_warehouse"

# Disable SSH tunneling - use local tunnel instead
# The local machine should run: ssh -L 0.0.0.0:5432:ox-stg-db-2.postgres.database.azure.com:5432 bastion@ox-stg-data-bastion-vm

# Call the generic PostgreSQL MCP wrapper
exec "/usr/local/bin/mcp-wrappers/postgres/postgres-mcp-wrapper.sh"
