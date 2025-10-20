FROM ghcr.io/metatool-ai/metamcp:latest

# Install Azure CLI and SSH client for PostgreSQL MCP
USER root
RUN apt-get update && \
    apt-get install -y curl gnupg lsb-release openssh-client && \
    curl -sL https://aka.ms/InstallAzureCLIDeb | bash && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy MCP wrappers
COPY mcp-wrappers/ /usr/local/bin/mcp-wrappers/
RUN chmod +x /usr/local/bin/mcp-wrappers/postgres/*.sh

# Create symlinks for easy access
RUN ln -s /usr/local/bin/mcp-wrappers/postgres/postgres-mcp-wrapper.sh /usr/local/bin/postgres-mcp-wrapper && \
    ln -s /usr/local/bin/mcp-wrappers/postgres/ox-staging-dwh.sh /usr/local/bin/ox-staging-dwh

# Switch back to the original user
USER nextjs