FROM node:20-slim

RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv curl jq && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    npm install -g supergateway && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
