import { DockerSessionStatusEnum, ServerParameters } from "@repo/zod-types";
import Docker from "dockerode";

import { dockerSessionsRepo } from "../../../db/repositories/docker-sessions.repo.js";
import { ContainerManager } from "./container-manager.js";
import { HealthMonitor } from "./health-monitor.js";
import { NetworkManager } from "./network-manager.js";
import { RetryManager } from "./retry-manager.js";
import { StatusSync } from "./status-sync.js";
import type {
  DetailedServerStatus,
  DockerMcpServer,
  HighRestartContainer,
  RetryInfo,
  SyncResult,
} from "./types.js";

/**
 * Main Docker Manager class that orchestrates all Docker-related operations for MetaMCP
 */
export class DockerManager {
  private static instance: DockerManager | null = null;
  private docker: Docker;

  // Component managers
  private networkManager: NetworkManager;
  private retryManager: RetryManager;
  private healthMonitor: HealthMonitor;
  private containerManager: ContainerManager;
  private statusSync: StatusSync;

  private constructor() {
    // Use DOCKER_HOST environment variable to communicate with host Docker
    const dockerHost = process.env.DOCKER_HOST || "unix:///var/run/docker.sock";

    if (dockerHost.startsWith("unix://")) {
      // For Unix socket connections, use socketPath
      this.docker = new Docker({
        socketPath: dockerHost.replace("unix://", ""),
      });
    } else if (dockerHost.startsWith("tcp://")) {
      // For TCP connections, parse the URL
      const url = new URL(dockerHost);
      const protocol = url.protocol.replace(":", "") as "http" | "https";
      this.docker = new Docker({
        host: url.hostname,
        port: parseInt(url.port) || 2376,
        protocol,
      });
    } else {
      // Fallback for other formats (assume it's a socket path)
      this.docker = new Docker({ socketPath: dockerHost });
    }

    // Initialize component managers
    this.networkManager = new NetworkManager(this.docker);
    this.retryManager = new RetryManager();
    this.healthMonitor = new HealthMonitor(this.docker);
    this.containerManager = new ContainerManager(
      this.docker,
      this.networkManager,
      this.retryManager,
      this.healthMonitor,
    );
    this.statusSync = new StatusSync(this.docker);
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): DockerManager {
    if (!DockerManager.instance) {
      DockerManager.instance = new DockerManager();
    }
    return DockerManager.instance;
  }

  // Container Management Methods
  async createContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    return this.containerManager.createContainer(serverUuid, serverParams);
  }

  async removeContainer(serverUuid: string): Promise<void> {
    return this.containerManager.removeContainer(serverUuid);
  }

  async updateServer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    return this.containerManager.updateServer(serverUuid, serverParams);
  }

  async retryContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    return this.containerManager.retryContainer(serverUuid, serverParams);
  }

  async initializeContainers(
    serverParams: Record<string, ServerParameters>,
  ): Promise<void> {
    return this.containerManager.initializeContainers(serverParams);
  }

  async cleanupAll(): Promise<void> {
    return this.containerManager.cleanupAll();
  }

  async getServerUrl(serverUuid: string): Promise<string | undefined> {
    return this.containerManager.getServerUrl(serverUuid);
  }

  async getRunningServers(): Promise<DockerMcpServer[]> {
    // First sync all container statuses
    await this.statusSync.syncAllContainerStatuses();
    return this.containerManager.getRunningServers();
  }

  async getServerLogsTail(
    serverUuid: string,
    tail: number = 500,
  ): Promise<string[]> {
    return this.containerManager.getServerLogsTail(serverUuid, tail);
  }

  // Status and Sync Methods
  async isServerRunning(serverUuid: string): Promise<boolean> {
    return this.statusSync.isServerRunning(serverUuid);
  }

  async verifyAndSyncContainerStatus(serverUuid: string): Promise<{
    isRunning: boolean;
    wasSynced: boolean;
  }> {
    return this.statusSync.verifyAndSyncContainerStatus(serverUuid);
  }

  async syncAllContainerStatuses(): Promise<SyncResult> {
    return this.statusSync.syncAllContainerStatuses();
  }

  async getServerStatus(serverUuid: string): Promise<{
    isRunning: boolean;
    wasSynced: boolean;
    containerId?: string;
    url?: string;
  }> {
    return this.statusSync.getServerStatus(serverUuid);
  }

  async getAllServerStatuses(): Promise<
    Array<{
      serverUuid: string;
      isRunning: boolean;
      wasSynced: boolean;
      containerId?: string;
      url?: string;
    }>
  > {
    return this.statusSync.getAllServerStatuses();
  }

  async getDetailedServerStatus(
    serverUuid: string,
  ): Promise<DetailedServerStatus> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return {
        isRunning: false,
        wasSynced: false,
        retryCount: 0,
        maxRetries: 3,
        status: DockerSessionStatusEnum.Enum.NOT_FOUND,
      };
    }

    const { isRunning, wasSynced } =
      await this.statusSync.verifyAndSyncContainerStatus(serverUuid);

    // Get restart count from health monitor
    const restartCount =
      await this.healthMonitor.getContainerRestartCount(serverUuid);

    return {
      isRunning,
      wasSynced,
      containerId: session.container_id,
      url: session.url,
      retryCount: session.retry_count,
      maxRetries: session.max_retries,
      lastRetryAt: session.last_retry_at || undefined,
      errorMessage: session.error_message || undefined,
      status: session.status,
      restartCount,
    };
  }

  // Health Monitoring Methods
  async startHealthMonitoringForExistingContainers(): Promise<void> {
    return this.healthMonitor.startHealthMonitoringForExistingContainers();
  }

  async getContainerRestartCount(serverUuid: string): Promise<number> {
    return this.healthMonitor.getContainerRestartCount(serverUuid);
  }

  async getContainersWithHighRestartCounts(): Promise<HighRestartContainer[]> {
    return this.healthMonitor.getContainersWithHighRestartCounts();
  }

  // Retry Management Methods
  async getServersWithRetryInfo(): Promise<RetryInfo[]> {
    return this.retryManager.getServersWithRetryInfo();
  }

  async getServersInErrorState(): Promise<
    Array<{
      serverUuid: string;
      retryCount: number;
      maxRetries: number;
      lastRetryAt?: Date;
      errorMessage?: string;
    }>
  > {
    return this.retryManager.getServersInErrorState();
  }

  async resetRetryCount(serverUuid: string): Promise<void> {
    return this.retryManager.resetRetryCount(serverUuid);
  }

  async logRetryStatistics(): Promise<void> {
    return this.retryManager.logRetryStatistics();
  }

  // Periodic Operations
  startPeriodicSync(intervalMs: number = 30000): NodeJS.Timeout {
    console.log(
      `Starting periodic container status sync every ${intervalMs}ms`,
    );

    return setInterval(async () => {
      try {
        const { syncedCount, totalCount } =
          await this.syncAllContainerStatuses();
        if (syncedCount > 0) {
          console.log(
            `Periodic sync: Updated ${syncedCount} out of ${totalCount} container statuses`,
          );
        }

        // Log retry statistics periodically
        await this.logRetryStatistics();

        // Check for containers with high restart counts
        const highRestartContainers =
          await this.getContainersWithHighRestartCounts();
        if (highRestartContainers.length > 0) {
          console.warn(
            `Found ${highRestartContainers.length} containers with high restart counts:`,
          );
          highRestartContainers.forEach((container) => {
            console.warn(
              `  - ${container.serverUuid}: ${container.restartCount} restarts`,
            );
          });

          // Actively handle containers with very high restart counts to prevent flapping
          for (const info of highRestartContainers) {
            try {
              // Only take action when restart count is at or above the same threshold as health monitor
              if (info.restartCount >= 3) {
                const session = await dockerSessionsRepo.getSessionByMcpServer(
                  info.serverUuid,
                );
                if (session) {
                  if (session.status !== DockerSessionStatusEnum.Enum.ERROR) {
                    await dockerSessionsRepo.markAsError(
                      session.uuid,
                      `Container has restarted ${info.restartCount} times due to crashes`,
                    );
                  }

                  // Attempt to stop the container to prevent further restarts
                  try {
                    const container = this.docker.getContainer(
                      info.containerId,
                    );
                    console.log(
                      `Stopping container ${info.containerId} for server ${info.serverUuid} due to high restart count (${info.restartCount})`,
                    );
                    await container.stop();
                    try {
                      await container.remove();
                      console.log(
                        `Removed container ${info.containerId} for server ${info.serverUuid} after stopping due to high restart count`,
                      );
                    } catch (removeError) {
                      console.error(
                        `Failed to remove container ${info.containerId} for server ${info.serverUuid}:`,
                        removeError,
                      );
                    }
                  } catch (stopError) {
                    console.error(
                      `Failed to stop container ${info.containerId} for server ${info.serverUuid}:`,
                      stopError,
                    );
                  }

                  // Stop any health monitoring loop for this server
                  this.healthMonitor.stopHealthMonitoring(info.serverUuid);
                }
              }
            } catch (handleError) {
              console.error(
                `Failed to handle high-restart container for server ${info.serverUuid}:`,
                handleError,
              );
            }
          }
        }
      } catch (error) {
        console.error("Error during periodic container status sync:", error);
      }
    }, intervalMs);
  }

  stopPeriodicSync(intervalId: NodeJS.Timeout): void {
    clearInterval(intervalId);
    console.log("Stopped periodic container status sync");
  }
}

// Create a singleton instance
export const dockerManager = DockerManager.getInstance();

// Re-export types for external use
export type {
  DockerMcpServer,
  DetailedServerStatus,
  RetryInfo,
  HighRestartContainer,
  SyncResult,
} from "./types.js";
