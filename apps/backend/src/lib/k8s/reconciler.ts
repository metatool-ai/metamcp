import logger from '@/utils/logger';
import { K8S_CONFIG } from './k8s-config';
import { computeCommandHash } from './command-hash';
import {
  ensurePodAndService,
  deletePodAndService,
  getPodStatus,
  listManagedResources,
} from './k8s-resource-manager';

// These will be dynamically imported to avoid circular dependencies
let mcpServersRepository: any;
let serverErrorTracker: any;

async function getRepositories() {
  if (!mcpServersRepository) {
    const repoModule = await import('../../db/repositories');
    mcpServersRepository = repoModule.mcpServersRepository;
  }
  if (!serverErrorTracker) {
    const trackerModule = await import('../metamcp/server-error-tracker');
    serverErrorTracker = trackerModule.serverErrorTracker;
  }
}

let reconcileTimer: NodeJS.Timeout | null = null;

export async function runReconciliation(): Promise<void> {
  try {
    await getRepositories();
    logger.info('Running K8s reconciliation...');

    // 1. Get all STDIO servers from DB
    const allServers = await mcpServersRepository.findAll();
    const stdioServers = allServers.filter(
      (s: any) => s.type === 'STDIO' && s.command
    );

    // Group by command hash
    const dbHashMap = new Map<string, { servers: any[]; command: string; args: string[]; env: Record<string, string> }>();
    for (const server of stdioServers) {
      const hash = computeCommandHash(server.command!, server.args || []);
      if (!dbHashMap.has(hash)) {
        dbHashMap.set(hash, {
          servers: [],
          command: server.command!,
          args: server.args || [],
          env: server.env || {},
        });
      }
      dbHashMap.get(hash)!.servers.push(server);
    }

    // 2. Ensure Pod+Service for each hash
    for (const [hash, info] of dbHashMap) {
      try {
        const serviceUrl = await ensurePodAndService({
          commandHash: hash,
          command: info.command,
          args: info.args,
          env: info.env,
        });

        // Update servers missing k8s_command_hash or k8s_service_url
        for (const server of info.servers) {
          if (!server.k8s_command_hash || !server.k8s_service_url) {
            await mcpServersRepository.update({
              uuid: server.uuid,
              k8s_command_hash: hash,
              k8s_service_url: serviceUrl,
            });
          }
        }
      } catch (err) {
        logger.error(`Reconciliation: failed to ensure Pod+Service for hash ${hash}:`, err);
      }
    }

    // 3. Clean up orphan K8s resources (exist in K8s but not in DB)
    const managedResources = await listManagedResources();
    for (const resource of managedResources) {
      if (!dbHashMap.has(resource.commandHash)) {
        logger.info(`Reconciliation: deleting orphan resources for hash ${resource.commandHash}`);
        await deletePodAndService(resource.commandHash).catch(err =>
          logger.error(`Error deleting orphan resources for hash ${resource.commandHash}:`, err)
        );
      }
    }

    // 4. Check pod status: mark ERROR for CrashLoopBackOff, recover ERROR when pod is ready
    for (const [hash, info] of dbHashMap) {
      const status = await getPodStatus(hash);
      if (status?.containerState === 'CrashLoopBackOff') {
        logger.warn(`Pod for hash ${hash} is in CrashLoopBackOff`);
        for (const server of info.servers) {
          await serverErrorTracker.recordServerCrash(server.uuid, null, 'CrashLoopBackOff');
        }
      } else if (status?.ready) {
        // Pod is healthy — clear ERROR status for servers that were previously marked
        for (const server of info.servers) {
          if (server.error_status === 'ERROR') {
            logger.info(`Pod for hash ${hash} is ready. Clearing ERROR status for server ${server.uuid}`);
            await serverErrorTracker.resetServerErrorState(server.uuid);
          }
        }
      }
    }

    logger.info('K8s reconciliation completed');
  } catch (error) {
    logger.error('K8s reconciliation failed:', error);
  }
}

export function startReconciler(): void {
  if (reconcileTimer) {
    return;
  }

  // Run initial reconciliation
  runReconciliation().catch(err =>
    logger.error('Initial reconciliation failed:', err)
  );

  // Schedule periodic reconciliation
  reconcileTimer = setInterval(() => {
    runReconciliation().catch(err =>
      logger.error('Periodic reconciliation failed:', err)
    );
  }, K8S_CONFIG.reconcileIntervalMs);

  logger.info(`K8s reconciler started (interval: ${K8S_CONFIG.reconcileIntervalMs}ms)`);
}

export function stopReconciler(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
    logger.info('K8s reconciler stopped');
  }
}
