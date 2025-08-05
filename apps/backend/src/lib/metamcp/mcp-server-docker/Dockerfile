FROM nikolaik/python-nodejs:python3.13-nodejs24

# Install system dependencies including jq
RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*

# Install mcp-proxy via pip
RUN uv pip install --system mcp-proxy

# Create app directory
WORKDIR /app

# Create entrypoint script
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Expose port for SSE/HTTP communication
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]