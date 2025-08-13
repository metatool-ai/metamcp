import { DockerSessionStatusEnum } from "@repo/zod-types";

import { dockerSessionsRepo } from "../../../db/repositories/docker-sessions.repo.js";
import type { RetryInfo } from "./types.js";

/**
 * Handles retry logic and error state management for Docker containers
 */
export class RetryManager {
  /**
   * Get servers with retry information for monitoring
   */
  async getServersWithRetryInfo(): Promise<RetryInfo[]> {
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
  async getServersInErrorState(): Promise<RetryInfo[]> {
    const sessions = await dockerSessionsRepo.getAllSessions();
    return sessions
      .filter(
        (session) => session.status === DockerSessionStatusEnum.Enum.ERROR,
      )
      .map((session) => ({
        serverUuid: session.mcp_server_uuid,
        retryCount: session.retry_count,
        maxRetries: session.max_retries,
        lastRetryAt: session.last_retry_at || undefined,
        errorMessage: session.error_message || undefined,
        status: session.status,
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
   * Handle retry logic for container creation failures
   */
  async handleContainerCreationFailure(
    serverUuid: string,
    error: unknown,
  ): Promise<void> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
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
          console.log(`Cleaned up temporary session for server ${serverUuid}`);
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

  /**
   * Reset retry state for container retry attempt
   */
  async resetRetryState(serverUuid: string): Promise<void> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      throw new Error(`No session found for server ${serverUuid}`);
    }

    if (session.status === DockerSessionStatusEnum.Enum.ERROR) {
      // Reset retry count and status for retry
      await dockerSessionsRepo.resetRetryCount(session.uuid);
      await dockerSessionsRepo.updateSessionStatus(
        session.uuid,
        DockerSessionStatusEnum.Enum.RUNNING,
      );
      console.log(
        `Reset retry count and status for server ${serverUuid}, attempting retry`,
      );
    }
  }
}
