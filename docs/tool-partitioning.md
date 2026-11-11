# Exposing large MCP namespaces

Some MCP clients enforce a hard maximum of 1,000 tools per connector. MetaMCP keeps the complete namespace intact and supports deterministic tool partitions for clients that need to access a larger namespace.

Use the same public Streamable HTTP endpoint with two query parameters:

- `toolPartitions`: total number of partitions (2100).
- `toolPartition`: zero-based partition index (`0` through `toolPartitions - 1`).

For a namespace with 2,032 tools, configure three connector entries using the same endpoint URL and authentication:

```text
https://YOUR_METAMCP_HOST/metamcp/YOUR_ENDPOINT/mcp?toolPartition=0&toolPartitions=3
https://YOUR_METAMCP_HOST/metamcp/YOUR_ENDPOINT/mcp?toolPartition=1&toolPartitions=3
https://YOUR_METAMCP_HOST/metamcp/YOUR_ENDPOINT/mcp?toolPartition=2&toolPartitions=3
```

Each tool name is assigned to exactly one partition using a stable hash. A tool remains in the same partition across sessions and discovery refreshes. Tool calls are checked against the session's partition, so a client cannot call a tool hidden from its partition. Each partition fails clearly if its assigned list exceeds the configured client limit rather than silently dropping tools.

The parameters must be supplied together. Invalid values are rejected with HTTP 400. Without partition parameters, the endpoint retains the backwards-compatible 1,000-tool cap and logs how many tools were omitted. Use enough partitions that each resulting list remains at or below 1,000 tools.
