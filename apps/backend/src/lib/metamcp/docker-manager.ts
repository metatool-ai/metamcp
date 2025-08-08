import { ServerParameters } from "@repo/zod-types";
import Docker from "dockerode";

import { dockerSessionsRepo } from "../../db/repositories/docker-sessions.repo.js";

export interface DockerMcpServer {
  containerId: string;
  serverUuid: string;
  containerName: string;
  url: string;
  serverName: string;
}

export class DockerManager {
  private static instance: DockerManager | null = null;
  private docker: Docker;
  private runningServers: Map<string, DockerMcpServer> = new Map();
  private readonly NETWORK_NAME = "metamcp_metamcp-internal";
  private containerRestartCounts: Map<string, number> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

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
  }

  /**
   * Determine whether a Dockerode/modem error represents a missing container (HTTP 404).
   */
  private isDockerContainerNotFoundError(error: unknown): boolean {
    const err = error as any;
    if (!err || typeof err !== "object") return false;
    const statusCode = err.statusCode;
    const reason = err.reason as string | undefined;
    const jsonMessage = err.json?.message as string | undefined;
    return (
      statusCode === 404 ||
      (typeof reason === "string" &&
        reason.toLowerCase().includes("no such container")) ||
      (typeof jsonMessage === "string" &&
        jsonMessage.toLowerCase().includes("no such container"))
    );
  }

  /**
   * Produce a concise summary string for Docker errors to avoid noisy stack traces in logs.
   */
  private dockerErrorSummary(error: unknown): string {
    const err = error as any;
    if (!err || typeof err !== "object") {
      return String(error);
    }
    const parts: string[] = [];
    if (err.statusCode) parts.push(`HTTP ${err.statusCode}`);
    if (err.reason) parts.push(String(err.reason));
    if (err.json?.message) parts.push(String(err.json.message));
    if (parts.length === 0 && err.message) parts.push(String(err.message));
    return parts.join(" - ") || "Unknown Docker error";
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

  /**
   * Ensure the internal network exists
   */
  private async ensureNetworkExists(): Promise<void> {
    try {
      // Try to get the network
      const network = this.docker.getNetwork(this.NETWORK_NAME);
      await network.inspect();
      console.log(`Network ${this.NETWORK_NAME} already exists`);
    } catch {
      // Network doesn't exist, create it
      console.log(`Creating network ${this.NETWORK_NAME}`);
      try {
        await this.docker.createNetwork({
          Name: this.NETWORK_NAME,
          Driver: "bridge",
          Internal: true, // Make it internal so it's not accessible from outside
          Labels: {
            "metamcp.managed": "true",
          },
        });
        console.log(`Created network ${this.NETWORK_NAME}`);
      } catch (createError) {
        // If creation fails, the network might have been created by docker-compose
        // Try to inspect it again
        try {
          const network = this.docker.getNetwork(this.NETWORK_NAME);
          await network.inspect();
          console.log(
            `Network ${this.NETWORK_NAME} exists (created by docker-compose)`,
          );
        } catch {
          console.error(
            `Failed to create or find network ${this.NETWORK_NAME}:`,
            createError,
          );
          throw createError;
        }
      }
    }
  }

  /**
   * Create a Docker container for an MCP server with retry logic
   */
  async createContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    // Ensure the internal network exists
    await this.ensureNetworkExists();

    // Check if already running in database
    let existingSession =
      await dockerSessionsRepo.getSessionByMcpServer(serverUuid);

    if (existingSession) {
      // If the session is marked as error (e.g., due to high restart count), do not recreate automatically
      // Require explicit manual recovery via retryContainer
      if (existingSession.status === "error") {
        throw new Error(
          `Server ${serverUuid} is in error state and will not be automatically recreated. Last error: ${existingSession.error_message ?? "unknown"}. Use retryContainer to attempt recovery.`,
        );
      }

      if (existingSession.status === "running") {
        // Verify that the container actually exists and is running
        try {
          const existingContainer = this.docker.getContainer(
            existingSession.container_id,
          );
          const containerInfo = await existingContainer.inspect();

          if (containerInfo.State.Running) {
            // Container exists and is running, reuse it
            const existingServer: DockerMcpServer = {
              containerId: existingSession.container_id,
              serverUuid,
              containerName: existingSession.container_name,
              url: existingSession.url,
              serverName:
                serverParams.name || `Server ${serverUuid.slice(0, 8)}`,
            };
            this.runningServers.set(serverUuid, existingServer);
            console.log(
              `Reusing existing running container for server ${serverUuid}:`,
              existingServer,
            );
            return existingServer;
          } else {
            // Container exists but not running, mark session as stopped
            console.log(
              `Container for server ${serverUuid} exists but is not running, marking session as stopped`,
            );
            await dockerSessionsRepo.stopSession(existingSession.uuid);
          }
        } catch {
          // Container doesn't exist, mark session as stopped
          console.log(
            `Container for server ${serverUuid} not found, marking session as stopped`,
          );
          await dockerSessionsRepo.stopSession(existingSession.uuid);
        }
      }
    } else {
      // Create a temporary session if none exists
      console.log(`Creating temporary session for server ${serverUuid}`);
      existingSession = await dockerSessionsRepo.createSession({
        mcp_server_uuid: serverUuid,
        container_id: `temp-${serverUuid}-${Date.now()}`,
        container_name: `temp-${serverUuid}`,
        url: `temp://${serverUuid}`,
      });
    }

    const containerName = `metamcp-stdio-server-${serverUuid}`;

    // Check if container already exists
    try {
      const existingContainer = this.docker.getContainer(containerName);
      const containerInfo = await existingContainer.inspect();

      if (containerInfo.State.Running) {
        // Container exists and is running, reuse it
        const internalUrl = `http://${containerName}:3000/sse`;

        const existingServer: DockerMcpServer = {
          containerId: containerInfo.Id,
          serverUuid,
          containerName,
          url: internalUrl,
          serverName: `temp-${serverUuid}`, // Placeholder, will be updated by DB
        };

        this.runningServers.set(serverUuid, existingServer);
        console.log(
          `Reusing existing container for server ${serverUuid}:`,
          existingServer,
        );
        return existingServer;
      } else {
        // Container exists but not running, remove it
        try {
          await existingContainer.remove();
        } catch (error) {
          if (this.isDockerContainerNotFoundError(error)) {
            console.info(
              `Container ${containerName} already removed when attempting cleanup`,
            );
          } else {
            console.warn(
              `Could not remove existing stopped container ${containerName}: ${this.dockerErrorSummary(error)}`,
            );
          }
        }
      }
    } catch {
      // Container doesn't exist, will create new one
      console.log(
        `No existing container found for server ${serverUuid}, creating new one`,
      );
    }

    // Create container configuration
    const containerConfig = {
      Image: "mcp/server:latest",
      name: containerName,
      Env: [
        `MCP_SERVER_COMMAND=${serverParams.command || ""}`,
        `MCP_SERVER_ARGS=${JSON.stringify(serverParams.args || [])}`,
        `MCP_SERVER_ENV=${JSON.stringify(serverParams.env || {})}`,
      ],
      ExposedPorts: {
        "3000/tcp": {},
      },
      HostConfig: {
        NetworkMode: this.NETWORK_NAME,
        RestartPolicy: {
          Name: "unless-stopped",
        },
      },
      Labels: {
        "metamcp.server.uuid": serverUuid,
        "metamcp.server.type": "stdio",
        "metamcp.managed": "true",
      },
    };

    try {
      const container = await this.docker.createContainer(containerConfig);
      await container.start();

      // Wait a moment for the container to fully start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if container is running and healthy
      const containerInfo = await container.inspect();
      console.log(
        `Container ${container.id} status:`,
        containerInfo.State.Status,
      );

      // Use internal container name for URL
      const internalUrl = `http://${containerName}:3000/sse`;

      // Update the session with actual container details
      await dockerSessionsRepo.updateSessionWithContainerDetails(
        serverUuid,
        container.id,
        containerName,
        internalUrl,
      );

      // Reset retry count on successful creation
      const session =
        await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
      if (session && session.retry_count > 0) {
        await dockerSessionsRepo.resetRetryCount(session.uuid);
        console.log(
          `Reset retry count for server ${serverUuid} after successful creation`,
        );
      }

      // Start health monitoring for this container
      this.startHealthMonitoring(serverUuid, container.id);

      const dockerServer: DockerMcpServer = {
        containerId: container.id,
        serverUuid,
        containerName,
        url: internalUrl,
        serverName: `temp-${serverUuid}`, // Placeholder, will be updated by DB
      };

      console.log(`Created Docker container for server ${serverUuid}:`, {
        containerId: container.id,
        containerName,
        url: dockerServer.url,
      });

      this.runningServers.set(serverUuid, dockerServer);
      return dockerServer;
    } catch (error) {
      console.error(
        `Error creating container for server ${serverUuid}:`,
        error,
      );

      // Handle retry logic
      const session =
        await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
      if (session) {
        const updatedSession = await dockerSessionsRepo.incrementRetryCount(
          session.uuid,
          error instanceof Error ? error.message : String(error),
        );

        if (
          updatedSession &&
          updatedSession.retry_count >= updatedSession.max_retries
        ) {
          // Mark as error after max retries
          await dockerSessionsRepo.markAsError(
            session.uuid,
            `Container creation failed after ${updatedSession.max_retries} attempts. Last error: ${error instanceof Error ? error.message : String(error)}`,
          );

          console.error(
            `Server ${serverUuid} has exceeded maximum retry attempts (${updatedSession.retry_count}/${updatedSession.max_retries}). Marking as error.`,
          );

          throw new Error(
            `Server ${serverUuid} has exceeded maximum retry attempts (${updatedSession.retry_count}/${updatedSession.max_retries}). Last error: ${error instanceof Error ? error.message : String(error)}`,
          );
        } else {
          console.warn(
            `Container creation failed for server ${serverUuid}, attempt ${updatedSession?.retry_count || 1}/${updatedSession?.max_retries || 3}. Will retry automatically.`,
          );

          // Clean up the temporary session if container creation failed
          try {
            if (session && session.container_id.startsWith("temp-")) {
              await dockerSessionsRepo.deleteSession(session.uuid);
              console.log(
                `Cleaned up temporary session for server ${serverUuid}`,
              );
            }
          } catch (cleanupError) {
            console.warn(
              `Failed to cleanup temporary session for server ${serverUuid}:`,
              cleanupError,
            );
          }

          throw error;
        }
      } else {
        // No session found, clean up and throw error
        try {
          const tempSession =
            await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
          if (tempSession && tempSession.container_id.startsWith("temp-")) {
            await dockerSessionsRepo.deleteSession(tempSession.uuid);
            console.log(
              `Cleaned up temporary session for server ${serverUuid}`,
            );
          }
        } catch (cleanupError) {
          console.warn(
            `Failed to cleanup temporary session for server ${serverUuid}:`,
            cleanupError,
          );
        }

        throw error;
      }
    }
  }

  /**
   * Remove a Docker container for an MCP server
   */
  async removeContainer(serverUuid: string): Promise<void> {
    // Check database first
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return;
    }

    try {
      const container = this.docker.getContainer(session.container_id);

      try {
        await container.stop();
      } catch (error) {
        // Container might already be stopped or missing
        if (this.isDockerContainerNotFoundError(error)) {
          console.info(
            `Container ${session.container_id} not found when stopping (already stopped/removed)`,
          );
        } else {
          console.warn(
            `Could not stop container ${session.container_id}: ${this.dockerErrorSummary(error)}`,
          );
        }
      }

      try {
        await container.remove();
      } catch (error) {
        // Container might already be removed
        if (this.isDockerContainerNotFoundError(error)) {
          console.info(`Container ${session.container_id} already removed`);
        } else {
          console.warn(
            `Could not remove container ${session.container_id}: ${this.dockerErrorSummary(error)}`,
          );
        }
      }

      // Update database session status
      await dockerSessionsRepo.stopSession(session.uuid);

      // Stop health monitoring for this container
      this.stopHealthMonitoring(serverUuid);

      this.runningServers.delete(serverUuid);
      console.log(`Removed container for server ${serverUuid}`);
    } catch (error) {
      console.error(
        `Error removing container for server ${serverUuid}: ${this.dockerErrorSummary(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get the URL for a Dockerized MCP server
   */
  async getServerUrl(serverUuid: string): Promise<string | undefined> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    return session?.url;
  }

  /**
   * Get all running Dockerized MCP servers with verification
   */
  async getRunningServers(): Promise<DockerMcpServer[]> {
    // First sync all container statuses
    await this.syncAllContainerStatuses();

    const sessions =
      await dockerSessionsRepo.getRunningSessionsWithServerNames();
    return sessions.map((session) => ({
      containerId: session.container_id,
      serverUuid: session.mcp_server_uuid,
      containerName: session.container_name,
      url: session.url,
      serverName: session.serverName,
    }));
  }

  /**
   * Start periodic container status synchronization
   */
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
                  if (session.status !== "error") {
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
                  this.stopHealthMonitoring(info.serverUuid);
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

  /**
   * Stop periodic container status synchronization
   */
  stopPeriodicSync(intervalId: NodeJS.Timeout): void {
    clearInterval(intervalId);
    console.log("Stopped periodic container status sync");
  }

  /**
   * Check if a server is running
   */
  async isServerRunning(serverUuid: string): Promise<boolean> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return false;
    }

    // Verify actual container status
    try {
      const container = this.docker.getContainer(session.container_id);
      const containerInfo = await container.inspect();
      const isActuallyRunning = containerInfo.State.Running;

      // Sync database if there's a discrepancy
      if (session.status === "running" && !isActuallyRunning) {
        console.log(
          `Container ${session.container_id} is stopped but DB shows running, updating status`,
        );
        await dockerSessionsRepo.stopSession(session.uuid);
        return false;
      } else if (session.status === "stopped" && isActuallyRunning) {
        console.log(
          `Container ${session.container_id} is running but DB shows stopped, updating status`,
        );
        await dockerSessionsRepo.updateSessionStatus(session.uuid, "running");
        return true;
      }

      return isActuallyRunning;
    } catch (error) {
      // Container doesn't exist or can't be inspected
      if (this.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found (likely removed). Treating as stopped.`,
        );
      } else {
        console.warn(
          `Could not inspect container ${session.container_id}: ${this.dockerErrorSummary(error)}`,
        );
      }
      if (session.status === "running") {
        console.log(
          `Container ${session.container_id} not found but DB shows running, updating status`,
        );
        await dockerSessionsRepo.stopSession(session.uuid);
      }
      return false;
    }
  }

  /**
   * Verify and sync container status with database
   */
  async verifyAndSyncContainerStatus(serverUuid: string): Promise<{
    isRunning: boolean;
    wasSynced: boolean;
  }> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return { isRunning: false, wasSynced: false };
    }

    try {
      const container = this.docker.getContainer(session.container_id);
      const containerInfo = await container.inspect();
      const isActuallyRunning = containerInfo.State.Running;

      let wasSynced = false;

      if (session.status === "running" && !isActuallyRunning) {
        console.log(
          `Syncing: Container ${session.container_id} is stopped but DB shows running`,
        );
        await dockerSessionsRepo.stopSession(session.uuid);
        wasSynced = true;
      } else if (session.status === "stopped" && isActuallyRunning) {
        console.log(
          `Syncing: Container ${session.container_id} is running but DB shows stopped`,
        );
        await dockerSessionsRepo.updateSessionStatus(session.uuid, "running");
        wasSynced = true;
      }

      return { isRunning: isActuallyRunning, wasSynced };
    } catch (error) {
      if (this.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found (likely removed). Syncing status to stopped if needed.`,
        );
      } else {
        console.warn(
          `Could not inspect container ${session.container_id}: ${this.dockerErrorSummary(error)}`,
        );
      }
      if (session.status === "running") {
        console.log(
          `Syncing: Container ${session.container_id} not found but DB shows running`,
        );
        await dockerSessionsRepo.stopSession(session.uuid);
        return { isRunning: false, wasSynced: true };
      }
      return { isRunning: false, wasSynced: false };
    }
  }

  /**
   * Sync all container statuses with database
   */
  async syncAllContainerStatuses(): Promise<{
    syncedCount: number;
    totalCount: number;
  }> {
    const sessions = await dockerSessionsRepo.getAllSessions();
    let syncedCount = 0;

    for (const session of sessions) {
      const { wasSynced } = await this.verifyAndSyncContainerStatus(
        session.mcp_server_uuid,
      );
      if (wasSynced) {
        syncedCount++;
      }
    }

    console.log(
      `Synced ${syncedCount} out of ${sessions.length} container statuses`,
    );
    return { syncedCount, totalCount: sessions.length };
  }

  /**
   * Update a server configuration (remove and recreate)
   */
  async updateServer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    await this.removeContainer(serverUuid);
    return await this.createContainer(serverUuid, serverParams);
  }

  /**
   * Clean up all running containers
   */
  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.runningServers.keys()).map((uuid) =>
      this.removeContainer(uuid),
    );
    await Promise.allSettled(cleanupPromises);
    this.runningServers.clear();
  }

  /**
   * Initialize containers for all stdio MCP servers
   */
  async initializeContainers(
    serverParams: Record<string, ServerParameters>,
  ): Promise<void> {
    const stdioServers = Object.entries(serverParams).filter(
      ([_, params]) => !params.type || params.type === "STDIO",
    );

    console.log(`Found ${stdioServers.length} stdio servers to initialize`);

    const initPromises = stdioServers.map(async ([uuid, params]) => {
      try {
        console.log(
          `Initializing container for server ${uuid} (${params.name})`,
        );
        const result = await this.createContainer(uuid, params);
        console.log(
          `✅ Successfully initialized container for server ${uuid}:`,
          result,
        );
        return { success: true, uuid, result };
      } catch (error) {
        console.error(
          `❌ Failed to initialize container for server ${uuid}:`,
          error,
        );
        return { success: false, uuid, error };
      }
    });

    const results = await Promise.allSettled(initPromises);

    // Log results
    let successCount = 0;
    let failureCount = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { success, uuid, error } = result.value;
        if (success) {
          successCount++;
        } else {
          failureCount++;
          console.error(`Container initialization failed for ${uuid}:`, error);
        }
      } else {
        failureCount++;
        console.error(
          "Container initialization failed with unhandled error:",
          result.reason,
        );
      }
    }

    console.log(
      `Container initialization complete: ${successCount} successful, ${failureCount} failed`,
    );
  }

  /**
   * Start health monitoring for all existing running containers
   */
  async startHealthMonitoringForExistingContainers(): Promise<void> {
    const sessions = await dockerSessionsRepo.getRunningSessions();
    console.log(
      `Starting health monitoring for ${sessions.length} existing containers`,
    );

    for (const session of sessions) {
      try {
        const container = this.docker.getContainer(session.container_id);
        const containerInfo = await container.inspect();

        if (containerInfo.State.Running) {
          this.startHealthMonitoring(
            session.mcp_server_uuid,
            session.container_id,
          );
          console.log(
            `Started health monitoring for container ${session.container_id}`,
          );
        } else {
          console.warn(
            `Container ${session.container_id} is not running, skipping health monitoring`,
          );
        }
      } catch (error) {
        if (this.isDockerContainerNotFoundError(error)) {
          console.info(
            `Container ${session.container_id} not found, skipping health monitoring`,
          );
        } else {
          console.warn(
            `Could not start health monitoring for container ${session.container_id}: ${this.dockerErrorSummary(error)}`,
          );
        }
      }
    }
  }

  /**
   * Get server status with verification
   */
  async getServerStatus(serverUuid: string): Promise<{
    isRunning: boolean;
    wasSynced: boolean;
    containerId?: string;
    url?: string;
  }> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return { isRunning: false, wasSynced: false };
    }

    const { isRunning, wasSynced } =
      await this.verifyAndSyncContainerStatus(serverUuid);

    return {
      isRunning,
      wasSynced,
      containerId: session.container_id,
      url: session.url,
    };
  }

  /**
   * Get detailed server status including retry information
   */
  async getDetailedServerStatus(serverUuid: string): Promise<{
    isRunning: boolean;
    wasSynced: boolean;
    containerId?: string;
    url?: string;
    retryCount: number;
    maxRetries: number;
    lastRetryAt?: Date;
    errorMessage?: string;
    status: string;
    restartCount?: number;
  }> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return {
        isRunning: false,
        wasSynced: false,
        retryCount: 0,
        maxRetries: 3,
        status: "not_found",
      };
    }

    const { isRunning, wasSynced } =
      await this.verifyAndSyncContainerStatus(serverUuid);

    // Get restart count from Docker
    let restartCount: number | undefined;
    try {
      const container = this.docker.getContainer(session.container_id);
      const containerInfo = await container.inspect();
      restartCount = containerInfo.RestartCount || 0;
    } catch (error) {
      console.warn(
        `Could not get restart count for server ${serverUuid}:`,
        error,
      );
    }

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

  /**
   * Get all server statuses with verification
   */
  async getAllServerStatuses(): Promise<
    Array<{
      serverUuid: string;
      isRunning: boolean;
      wasSynced: boolean;
      containerId?: string;
      url?: string;
    }>
  > {
    const sessions = await dockerSessionsRepo.getAllSessions();
    const statuses = [];

    for (const session of sessions) {
      const { isRunning, wasSynced } = await this.verifyAndSyncContainerStatus(
        session.mcp_server_uuid,
      );
      statuses.push({
        serverUuid: session.mcp_server_uuid,
        isRunning,
        wasSynced,
        containerId: session.container_id,
        url: session.url,
      });
    }

    return statuses;
  }

  /**
   * Get servers with retry information for monitoring
   */
  async getServersWithRetryInfo(): Promise<
    Array<{
      serverUuid: string;
      retryCount: number;
      maxRetries: number;
      lastRetryAt?: Date;
      errorMessage?: string;
      status: string;
    }>
  > {
    const sessions = await dockerSessionsRepo.getSessionsWithRetryInfo();
    return sessions.map((session) => ({
      serverUuid: session.mcp_server_uuid,
      retryCount: session.retry_count,
      maxRetries: session.max_retries,
      lastRetryAt: session.last_retry_at || undefined,
      errorMessage: session.error_message || undefined,
      status: session.status,
    }));
  }

  /**
   * Get servers in error state (exceeded max retries)
   */
  async getServersInErrorState(): Promise<
    Array<{
      serverUuid: string;
      retryCount: number;
      maxRetries: number;
      lastRetryAt?: Date;
      errorMessage?: string;
    }>
  > {
    const sessions = await dockerSessionsRepo.getAllSessions();
    return sessions
      .filter((session) => session.status === "error")
      .map((session) => ({
        serverUuid: session.mcp_server_uuid,
        retryCount: session.retry_count,
        maxRetries: session.max_retries,
        lastRetryAt: session.last_retry_at || undefined,
        errorMessage: session.error_message || undefined,
      }));
  }

  /**
   * Reset retry count for a server (useful for manual recovery)
   */
  async resetRetryCount(serverUuid: string): Promise<void> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (session) {
      await dockerSessionsRepo.resetRetryCount(session.uuid);
      console.log(`Reset retry count for server ${serverUuid}`);
    }
  }

  /**
   * Retry a failed container (useful for manual recovery)
   */
  async retryContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      throw new Error(`No session found for server ${serverUuid}`);
    }

    if (session.status === "error") {
      // Reset retry count and status for retry
      await dockerSessionsRepo.resetRetryCount(session.uuid);
      await dockerSessionsRepo.updateSessionStatus(session.uuid, "running");
      console.log(
        `Reset retry count and status for server ${serverUuid}, attempting retry`,
      );
    }

    // Remove existing container if it exists
    try {
      await this.removeContainer(serverUuid);
    } catch (error) {
      console.warn(
        `Could not remove existing container for ${serverUuid}:`,
        error,
      );
    }

    // Create new container
    return await this.createContainer(serverUuid, serverParams);
  }

  /**
   * Monitor and log retry statistics
   */
  async logRetryStatistics(): Promise<void> {
    const sessionsWithRetries = await this.getServersWithRetryInfo();
    const errorSessions = await this.getServersInErrorState();

    if (sessionsWithRetries.length > 0) {
      console.log(`Servers with retry attempts: ${sessionsWithRetries.length}`);
      sessionsWithRetries.forEach((session) => {
        console.log(
          `  - ${session.serverUuid}: ${session.retryCount}/${session.maxRetries} attempts`,
        );
      });
    }

    if (errorSessions.length > 0) {
      console.error(`Servers in error state: ${errorSessions.length}`);
      errorSessions.forEach((session) => {
        console.error(
          `  - ${session.serverUuid}: ${session.retryCount}/${session.maxRetries} attempts failed`,
        );
        if (session.errorMessage) {
          console.error(`    Last error: ${session.errorMessage}`);
        }
      });
    }
  }

  /**
   * Start health monitoring for a container
   */
  private startHealthMonitoring(serverUuid: string, containerId: string): void {
    // Clear any existing health check interval
    this.stopHealthMonitoring(serverUuid);

    const interval = setInterval(async () => {
      try {
        const container = this.docker.getContainer(containerId);
        const containerInfo = await container.inspect();

        // Check if container has restarted
        const restartCount = containerInfo.RestartCount || 0;
        const previousRestartCount =
          this.containerRestartCounts.get(serverUuid) || 0;

        if (restartCount > previousRestartCount) {
          console.warn(
            `Container ${containerId} for server ${serverUuid} has restarted ${restartCount} times (previous: ${previousRestartCount})`,
          );

          // Update restart count
          this.containerRestartCounts.set(serverUuid, restartCount);

          // Check if we should mark as error based on restart count
          if (restartCount >= 3) {
            console.error(
              `Container ${containerId} for server ${serverUuid} has restarted ${restartCount} times, marking as error`,
            );

            // Mark session as error
            const session =
              await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
            if (session) {
              await dockerSessionsRepo.markAsError(
                session.uuid,
                `Container has restarted ${restartCount} times due to crashes`,
              );
            }

            // Stop the container to prevent infinite restarts
            try {
              console.log(
                `Stopping container ${containerId} to prevent infinite restarts`,
              );
              await container.stop();
              console.log(
                `Successfully stopped container ${containerId} for server ${serverUuid}`,
              );
            } catch (stopError) {
              console.error(
                `Failed to stop container ${containerId} for server ${serverUuid}:`,
                stopError,
              );
            }

            // Stop health monitoring for this container
            this.stopHealthMonitoring(serverUuid);
          }
        }

        // Check if container is running
        if (!containerInfo.State.Running) {
          console.warn(
            `Container ${containerId} for server ${serverUuid} is not running`,
          );
        }
      } catch (error) {
        if (this.isDockerContainerNotFoundError(error)) {
          console.info(
            `Container ${containerId} for server ${serverUuid} no longer exists; stopping health monitoring`,
          );
          this.stopHealthMonitoring(serverUuid);
        } else {
          console.error(
            `Error monitoring container ${containerId} for server ${serverUuid}: ${this.dockerErrorSummary(error)}`,
          );
        }
      }
    }, 10000); // Check every 10 seconds

    this.healthCheckIntervals.set(serverUuid, interval);
  }

  /**
   * Stop health monitoring for a container
   */
  private stopHealthMonitoring(serverUuid: string): void {
    const interval = this.healthCheckIntervals.get(serverUuid);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(serverUuid);
    }
  }

  /**
   * Get container restart count for a server
   */
  async getContainerRestartCount(serverUuid: string): Promise<number> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return 0;
    }

    try {
      const container = this.docker.getContainer(session.container_id);
      const containerInfo = await container.inspect();
      return containerInfo.RestartCount || 0;
    } catch (error) {
      if (this.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found when reading restart count`,
        );
      } else {
        console.warn(
          `Could not get restart count for server ${serverUuid}: ${this.dockerErrorSummary(error)}`,
        );
      }
      return 0;
    }
  }

  /**
   * Get all containers with high restart counts
   */
  async getContainersWithHighRestartCounts(): Promise<
    Array<{
      serverUuid: string;
      containerId: string;
      restartCount: number;
      status: string;
    }>
  > {
    const sessions = await dockerSessionsRepo.getAllSessions();
    const highRestartContainers = [];

    for (const session of sessions) {
      try {
        const container = this.docker.getContainer(session.container_id);
        const containerInfo = await container.inspect();
        const restartCount = containerInfo.RestartCount || 0;

        if (restartCount >= 2) {
          highRestartContainers.push({
            serverUuid: session.mcp_server_uuid,
            containerId: session.container_id,
            restartCount,
            status: session.status,
          });
        }
      } catch (error) {
        if (this.isDockerContainerNotFoundError(error)) {
          // Expected in some flows (e.g., container already cleaned up)
          // Reduce noise by logging a concise info message
          console.info(
            `Container ${session.container_id} for server ${session.mcp_server_uuid} not found while checking restart counts`,
          );
        } else {
          console.warn(
            `Could not inspect container for server ${session.mcp_server_uuid}: ${this.dockerErrorSummary(error)}`,
          );
        }
      }
    }

    return highRestartContainers;
  }

  /**
   * Get the last N log lines from a server's Docker container (stdout and stderr)
   */
  async getServerLogsTail(
    serverUuid: string,
    tail: number = 500,
  ): Promise<string[]> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return [];
    }

    try {
      const container = this.docker.getContainer(session.container_id);
      // Include timestamps to help ordering/visibility
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
        follow: false,
      });

      const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(String(logs));
      const content = buffer.toString("utf8");
      // Normalize line endings and split
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      // Trim any trailing empty line
      if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
      }
      return lines;
    } catch (error) {
      if (this.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found when reading logs`,
        );
      } else {
        console.error(
          `Failed to read logs for server ${serverUuid} (container ${session.container_id}): ${this.dockerErrorSummary(error)}`,
        );
      }
      return [];
    }
  }
}

// Create a singleton instance
export const dockerManager = DockerManager.getInstance();
