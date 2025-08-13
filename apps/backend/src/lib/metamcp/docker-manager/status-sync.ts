import { DockerSessionStatusEnum } from "@repo/zod-types";
import Docker from "dockerode";

import { dockerSessionsRepo } from "../../../db/repositories/docker-sessions.repo.js";
import { DockerErrorUtils } from "./error-utils.js";
import type { ServerStatus, SyncResult } from "./types.js";

/**
 * Handles synchronization of container statuses with the database
 */
export class StatusSync {
  private docker: Docker;

  constructor(docker: Docker) {
    this.docker = docker;
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
      if (
        session.status === DockerSessionStatusEnum.Enum.RUNNING &&
        !isActuallyRunning
      ) {
        console.log(
          `Container ${session.container_id} is stopped but DB shows running, updating status`,
        );
        await dockerSessionsRepo.stopSession(session.uuid);
        return false;
      } else if (
        session.status === DockerSessionStatusEnum.Enum.STOPPED &&
        isActuallyRunning
      ) {
        console.log(
          `Container ${session.container_id} is running but DB shows stopped, updating status`,
        );
        await dockerSessionsRepo.updateSessionStatus(
          session.uuid,
          DockerSessionStatusEnum.Enum.RUNNING,
        );
        return true;
      }

      return isActuallyRunning;
    } catch (error) {
      // Container doesn't exist or can't be inspected
      if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found (likely removed). Treating as stopped.`,
        );
      } else {
        console.warn(
          `Could not inspect container ${session.container_id}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
        );
      }
      if (session.status === DockerSessionStatusEnum.Enum.RUNNING) {
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

      if (
        session.status === DockerSessionStatusEnum.Enum.RUNNING &&
        !isActuallyRunning
      ) {
        console.log(
          `Syncing: Container ${session.container_id} is stopped but DB shows running`,
        );
        await dockerSessionsRepo.stopSession(session.uuid);
        wasSynced = true;
      } else if (
        session.status === DockerSessionStatusEnum.Enum.STOPPED &&
        isActuallyRunning
      ) {
        console.log(
          `Syncing: Container ${session.container_id} is running but DB shows stopped`,
        );
        await dockerSessionsRepo.updateSessionStatus(
          session.uuid,
          DockerSessionStatusEnum.Enum.RUNNING,
        );
        wasSynced = true;
      }

      return { isRunning: isActuallyRunning, wasSynced };
    } catch (error) {
      if (DockerErrorUtils.isDockerContainerNotFoundError(error)) {
        console.info(
          `Container ${session.container_id} for server ${serverUuid} not found (likely removed). Syncing status to stopped if needed.`,
        );
      } else {
        console.warn(
          `Could not inspect container ${session.container_id}: ${DockerErrorUtils.dockerErrorSummary(error)}`,
        );
      }
      if (session.status === DockerSessionStatusEnum.Enum.RUNNING) {
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
  async syncAllContainerStatuses(): Promise<SyncResult> {
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
   * Get server status with verification
   */
  async getServerStatus(serverUuid: string): Promise<ServerStatus> {
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
   * Get all server statuses with verification
   */
  async getAllServerStatuses(): Promise<
    Array<ServerStatus & { serverUuid: string }>
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
}
