import { ServerParameters } from "@repo/zod-types";
import Docker from "dockerode";

import { dockerSessionsRepo } from "../../../db/repositories/docker-sessions.repo.js";
import { DockerErrorUtils } from "./error-utils.js";
import { HealthMonitor } from "./health-monitor.js";
import { NetworkManager } from "./network-manager.js";
import { RetryManager } from "./retry-manager.js";
import type { ContainerConfig, DockerMcpServer } from "./types.js";

/**
 * Handles Docker container creation, removal, and management for MCP servers
 */
export class ContainerManager {
  private docker: Docker;
  private networkManager: NetworkManager;
  private retryManager: RetryManager;
  private healthMonitor: HealthMonitor;
  private runningServers: Map<string, DockerMcpServer> = new Map();

  constructor(
    docker: Docker,
    networkManager: NetworkManager,
    retryManager: RetryManager,
    healthMonitor: HealthMonitor,
  ) {
    this.docker = docker;
    this.networkManager = networkManager;
    this.retryManager = retryManager;
    this.healthMonitor = healthMonitor;
  }

  /**
   * Create a Docker container for an MCP server with retry logic
   */
  async createContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    // Ensure the internal network exists
    await this.networkManager.ensureNetworkExists();

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
          if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
            console.info(
              `Container ${containerName} already removed when attempting cleanup`,
            );
          } else {
            console.warn(
              `Could not remove existing stopped container ${containerName}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
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
    const containerConfig: ContainerConfig = {
      Image: "ghcr.io/metatool-ai/mcp-proxy:latest",
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
        NetworkMode: this.networkManager.getNetworkName(),
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
      this.healthMonitor.startHealthMonitoring(serverUuid, container.id);

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
      await this.retryManager.handleContainerCreationFailure(serverUuid, error);
      throw error; // This will be rethrown by the retry manager
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
        if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
          console.info(
            `Container ${session.container_id} not found when stopping (already stopped/removed)`,
          );
        } else {
          console.warn(
            `Could not stop container ${session.container_id}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
          );
        }
      }

      try {
        await container.remove();
      } catch (error) {
        // Container might already be removed
        if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
          console.info(`Container ${session.container_id} already removed`);
        } else {
          console.warn(
            `Could not remove container ${session.container_id}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
          );
        }
      }

      // Update database session status
      await dockerSessionsRepo.stopSession(session.uuid);

      // Stop health monitoring for this container
      this.healthMonitor.stopHealthMonitoring(serverUuid);

      this.runningServers.delete(serverUuid);
      console.log(`Removed container for server ${serverUuid}`);
    } catch (error) {
      console.error(
        `Error removing container for server ${serverUuid}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
      );
      throw error;
    }
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
   * Retry a failed container (useful for manual recovery)
   */
  async retryContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    // Reset retry state
    await this.retryManager.resetRetryState(serverUuid);

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
      if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found when reading logs`,
        );
      } else {
        console.error(
          `Failed to read logs for server ${serverUuid} (container ${session.container_id}): ${DockerErrorUtils.dockerErrorSummary(error)}`,
        );
      }
      return [];
    }
  }
}
