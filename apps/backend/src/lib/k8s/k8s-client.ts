import * as k8s from '@kubernetes/client-node';
import { readFileSync } from 'node:fs';
import { K8S_CONFIG } from './k8s-config';
import logger from '@/utils/logger';

let coreApi: k8s.CoreV1Api;
let namespace: string;

export function initializeK8sClient(): void {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  coreApi = kc.makeApiClient(k8s.CoreV1Api);

  // Determine namespace
  if (K8S_CONFIG.namespace) {
    namespace = K8S_CONFIG.namespace;
  } else {
    try {
      namespace = readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').trim();
    } catch {
      namespace = 'default';
    }
  }

  logger.info(`K8s client initialized. Namespace: ${namespace}`);
}

export function getCoreApi(): k8s.CoreV1Api {
  if (!coreApi) {
    throw new Error('K8s client not initialized. Call initializeK8sClient() first.');
  }
  return coreApi;
}

export function getNamespace(): string {
  if (!namespace) {
    throw new Error('K8s client not initialized. Call initializeK8sClient() first.');
  }
  return namespace;
}
