import Docker from "dockerode";

import { dockerSessionsRepo } from "../../../db/repositories/docker-sessions.repo.js";
import { DockerErrorUtils } from "./error-utils.js";

/**
 * Handles container health monitoring and restart tracking
 */
export class HealthMonitor {
  private docker: Docker;
  private containerRestartCounts: Map<string, number> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(docker: Docker) {
    this.docker = docker;
  }

  /**
   * Start health monitoring for a container
   */
  startHealthMonitoring(serverUuid: string, containerId: string): void {
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
        if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
          console.info(
            `Container ${containerId} for server ${serverUuid} no longer exists; stopping health monitoring`,
          );
          this.stopHealthMonitoring(serverUuid);
        } else {
          console.error(
            `Error monitoring container ${containerId} for server ${serverUuid}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
          );
        }
      }
    }, 10000); // Check every 10 seconds

    this.healthCheckIntervals.set(serverUuid, interval);
  }

  /**
   * Stop health monitoring for a container
   */
  stopHealthMonitoring(serverUuid: string): void {
    const interval = this.healthCheckIntervals.get(serverUuid);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(serverUuid);
    }
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
        if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
          console.info(
            `Container ${session.container_id} not found, skipping health monitoring`,
          );
        } else {
          console.warn(
            `Could not start health monitoring for container ${session.container_id}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
          );
        }
      }
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
      if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found when reading restart count`,
        );
      } else {
        console.warn(
          `Could not get restart count for server ${serverUuid}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
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
        if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
          // Expected in some flows (e.g., container already cleaned up)
          // Reduce noise by logging a concise info message
          console.info(
            `Container ${session.container_id} for server ${session.mcp_server_uuid} not found while checking restart counts`,
          );
        } else {
          console.warn(
            `Could not inspect container for server ${session.mcp_server_uuid}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
          );
        }
      }
    }

    return highRestartContainers;
  }
}
