export { initializeK8sClient, getCoreApi, getNamespace } from './k8s-client';
export { K8S_CONFIG } from './k8s-config';
export { computeCommandHash } from './command-hash';
export {
  ensurePodAndService,
  deletePodAndService,
  getPodStatus,
  waitForReady,
  listManagedResources,
} from './k8s-resource-manager';
export type { StdioPodConfig, PodStatus, K8sManagedResource } from './k8s-resource-manager';
export { runReconciliation, startReconciler, stopReconciler } from './reconciler';
