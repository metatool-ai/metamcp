FROM nikolaik/python-nodejs:python3.13-nodejs24

# Install mcp-proxy via pip
RUN uv pip install mcp-proxy

# Create app directory
WORKDIR /app

# Create entrypoint script
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Expose port for SSE/HTTP communication
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]