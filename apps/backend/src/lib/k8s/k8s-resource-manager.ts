import * as k8s from '@kubernetes/client-node';
import logger from '@/utils/logger';
import { getCoreApi, getNamespace } from './k8s-client';
import { K8S_CONFIG } from './k8s-config';

export interface StdioPodConfig {
  commandHash: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface PodStatus {
  phase: string;
  ready: boolean;
  restartCount: number;
  containerState?: string;
}

export interface K8sManagedResource {
  commandHash: string;
  podName: string;
  serviceName: string;
  serviceUrl: string;
  podPhase: string;
  ready: boolean;
}

const MANAGED_BY_LABEL = 'metamcp';
const LABEL_COMMAND_HASH = 'metamcp.io/command-hash';
const LABEL_MANAGED_BY = 'app.kubernetes.io/managed-by';

function isNotFound(err: any): boolean {
  return err?.code === 404 || isNotFound(err);
}

function getPodName(commandHash: string): string {
  return `metamcp-mcp-${commandHash}`;
}

function getServiceName(commandHash: string): string {
  return `metamcp-mcp-${commandHash}`;
}

function getServiceUrl(commandHash: string): string {
  const ns = getNamespace();
  return `http://${getServiceName(commandHash)}.${ns}.svc.cluster.local:${K8S_CONFIG.supergatewayPort}/mcp`;
}

function buildPodSpec(config: StdioPodConfig): k8s.V1Pod {
  const envVars: k8s.V1EnvVar[] = [
    { name: 'MCP_COMMAND', value: config.command },
    { name: 'MCP_ARGS', value: JSON.stringify(config.args) },
  ];

  if (config.env && Object.keys(config.env).length > 0) {
    envVars.push({ name: 'MCP_ENV_JSON', value: JSON.stringify(config.env) });
  }

  return {
    metadata: {
      name: getPodName(config.commandHash),
      labels: {
        [LABEL_MANAGED_BY]: MANAGED_BY_LABEL,
        [LABEL_COMMAND_HASH]: config.commandHash,
      },
    },
    spec: {
      restartPolicy: 'Always',
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  {
                    key: 'kubernetes.io/arch',
                    operator: 'In',
                    values: ['arm64'],
                  },
                ],
              },
            ],
          },
        },
      },
      containers: [
        {
          name: 'supergateway',
          image: K8S_CONFIG.supergatewayImage,
          ports: [{ containerPort: K8S_CONFIG.supergatewayPort }],
          env: envVars,
          resources: {
            requests: {
              cpu: K8S_CONFIG.podCpuRequest,
              memory: K8S_CONFIG.podMemoryRequest,
            },
            limits: {
              cpu: K8S_CONFIG.podCpuLimit,
              memory: K8S_CONFIG.podMemoryLimit,
            },
          },
          readinessProbe: {
            httpGet: {
              path: '/healthz',
              port: K8S_CONFIG.supergatewayPort as any,
            },
            initialDelaySeconds: 5,
            periodSeconds: 10,
          },
        },
      ],
    },
  };
}

function buildServiceSpec(commandHash: string): k8s.V1Service {
  return {
    metadata: {
      name: getServiceName(commandHash),
      labels: {
        [LABEL_MANAGED_BY]: MANAGED_BY_LABEL,
        [LABEL_COMMAND_HASH]: commandHash,
      },
    },
    spec: {
      type: 'ClusterIP',
      selector: {
        [LABEL_MANAGED_BY]: MANAGED_BY_LABEL,
        [LABEL_COMMAND_HASH]: commandHash,
      },
      ports: [
        {
          port: K8S_CONFIG.supergatewayPort,
          targetPort: K8S_CONFIG.supergatewayPort as any,
          protocol: 'TCP',
        },
      ],
    },
  };
}

export async function ensurePodAndService(config: StdioPodConfig): Promise<string> {
  const api = getCoreApi();
  const ns = getNamespace();
  const podName = getPodName(config.commandHash);
  const serviceName = getServiceName(config.commandHash);

  // Ensure Pod (idempotent)
  try {
    await api.readNamespacedPod({ name: podName, namespace: ns });
    logger.info(`Pod ${podName} already exists`);
  } catch (err: any) {
    if (isNotFound(err)) {
      logger.info(`Creating Pod ${podName}`);
      await api.createNamespacedPod({ namespace: ns, body: buildPodSpec(config) });
    } else {
      throw err;
    }
  }

  // Ensure Service (idempotent)
  try {
    await api.readNamespacedService({ name: serviceName, namespace: ns });
    logger.info(`Service ${serviceName} already exists`);
  } catch (err: any) {
    if (isNotFound(err)) {
      logger.info(`Creating Service ${serviceName}`);
      await api.createNamespacedService({ namespace: ns, body: buildServiceSpec(config.commandHash) });
    } else {
      throw err;
    }
  }

  return getServiceUrl(config.commandHash);
}

export async function deletePodAndService(commandHash: string): Promise<void> {
  const api = getCoreApi();
  const ns = getNamespace();
  const podName = getPodName(commandHash);
  const serviceName = getServiceName(commandHash);

  // Delete Service
  try {
    await api.deleteNamespacedService({ name: serviceName, namespace: ns });
    logger.info(`Deleted Service ${serviceName}`);
  } catch (err: any) {
    if (!isNotFound(err)) {
      logger.error(`Error deleting Service ${serviceName}:`, err);
    }
  }

  // Delete Pod
  try {
    await api.deleteNamespacedPod({ name: podName, namespace: ns });
    logger.info(`Deleted Pod ${podName}`);
  } catch (err: any) {
    if (!isNotFound(err)) {
      logger.error(`Error deleting Pod ${podName}:`, err);
    }
  }
}

export async function getPodStatus(commandHash: string): Promise<PodStatus | null> {
  const api = getCoreApi();
  const ns = getNamespace();
  const podName = getPodName(commandHash);

  try {
    const pod = await api.readNamespacedPod({ name: podName, namespace: ns });
    const containerStatus = pod.status?.containerStatuses?.[0];
    const phase = pod.status?.phase || 'Unknown';
    const ready = containerStatus?.ready || false;
    const restartCount = containerStatus?.restartCount || 0;

    let containerState: string | undefined;
    if (containerStatus?.state?.waiting) {
      containerState = containerStatus.state.waiting.reason || 'Waiting';
    } else if (containerStatus?.state?.running) {
      containerState = 'Running';
    } else if (containerStatus?.state?.terminated) {
      containerState = containerStatus.state.terminated.reason || 'Terminated';
    }

    return { phase, ready, restartCount, containerState };
  } catch (err: any) {
    if (isNotFound(err)) {
      return null;
    }
    throw err;
  }
}

export async function waitForReady(commandHash: string, timeoutMs?: number): Promise<boolean> {
  const timeout = timeoutMs || K8S_CONFIG.podReadyTimeoutMs;
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getPodStatus(commandHash);
    if (status?.ready) {
      return true;
    }
    if (status?.containerState === 'CrashLoopBackOff' || status?.containerState === 'ImagePullBackOff') {
      logger.error(`Pod for hash ${commandHash} in ${status.containerState} state`);
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  logger.warn(`Timed out waiting for Pod with hash ${commandHash} to become ready`);
  return false;
}

export async function listManagedResources(): Promise<K8sManagedResource[]> {
  const api = getCoreApi();
  const ns = getNamespace();
  const labelSelector = `${LABEL_MANAGED_BY}=${MANAGED_BY_LABEL}`;

  const pods = await api.listNamespacedPod({ namespace: ns, labelSelector });
  const resources: K8sManagedResource[] = [];

  for (const pod of pods.items) {
    const commandHash = pod.metadata?.labels?.[LABEL_COMMAND_HASH];
    if (!commandHash) continue;

    const containerStatus = pod.status?.containerStatuses?.[0];
    resources.push({
      commandHash,
      podName: pod.metadata?.name || '',
      serviceName: getServiceName(commandHash),
      serviceUrl: getServiceUrl(commandHash),
      podPhase: pod.status?.phase || 'Unknown',
      ready: containerStatus?.ready || false,
    });
  }

  return resources;
}
