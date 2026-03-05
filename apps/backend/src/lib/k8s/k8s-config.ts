export const K8S_CONFIG = {
  namespace: process.env.K8S_MCP_NAMESPACE || '',
  supergatewayImage: process.env.SUPERGATEWAY_IMAGE || 'ghcr.io/dalphakr/metamcp-supergateway:latest',
  supergatewayPort: parseInt(process.env.SUPERGATEWAY_PORT || '8000', 10),
  podCpuRequest: process.env.K8S_POD_CPU_REQUEST || '100m',
  podCpuLimit: process.env.K8S_POD_CPU_LIMIT || '500m',
  podMemoryRequest: process.env.K8S_POD_MEMORY_REQUEST || '128Mi',
  podMemoryLimit: process.env.K8S_POD_MEMORY_LIMIT || '512Mi',
  podReadyTimeoutMs: parseInt(process.env.K8S_POD_READY_TIMEOUT_MS || '120000', 10),
  reconcileIntervalMs: parseInt(process.env.K8S_RECONCILE_INTERVAL_MS || '60000', 10),
} as const;
