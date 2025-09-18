import { McpServerErrorStatusEnum } from "@repo/zod-types";

import { mcpServersRepository } from "../../db/repositories/index";
import { configService } from "../config.service";

export interface ServerCrashInfo {
  serverUuid: string;
  exitCode: number | null;
  signal: string | null;
  timestamp: Date;
}

export class ServerErrorTracker {
  private static instance: ServerErrorTracker | null = null;

  // Track crash attempts per server
  private crashAttempts: Map<string, number> = new Map();

  // Default max attempts before marking as ERROR (fallback if config is not available)
  private readonly fallbackMaxAttempts: number = 1;

  // Server-specific max attempts (can be configured per server)
  private serverMaxAttempts: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): ServerErrorTracker {
    if (!ServerErrorTracker.instance) {
      ServerErrorTracker.instance = new ServerErrorTracker();
    }
    return ServerErrorTracker.instance;
  }

  /**
   * Set max attempts for a specific server
   */
  setServerMaxAttempts(serverUuid: string, maxAttempts: number): void {
    this.serverMaxAttempts.set(serverUuid, maxAttempts);
  }

  /**
   * Get max attempts for a specific server
   */
  async getServerMaxAttempts(serverUuid: string): Promise<number> {
    // First check for server-specific configuration
    const serverSpecific = this.serverMaxAttempts.get(serverUuid);
    if (serverSpecific !== undefined) {
      return serverSpecific;
    }

    // Then check global configuration
    try {
      return await configService.getMcpMaxAttempts();
    } catch (error) {
      console.warn(
        "Failed to get MCP max attempts from config, using fallback:",
        error,
      );
      return this.fallbackMaxAttempts;
    }
  }

  /**
   * Record a server crash and check if it should be marked as ERROR
   */
  async recordServerCrash(
    serverUuid: string,
    exitCode: number | null,
    signal: string | null,
  ): Promise<void> {
    console.log(`recordServerCrash called for server ${serverUuid}`);

    // Get current attempt count
    const currentAttempts = this.crashAttempts.get(serverUuid) || 0;
    const newAttempts = currentAttempts + 1;

    // Update crash attempts tracking
    this.crashAttempts.set(serverUuid, newAttempts);

    const maxAttempts = await this.getServerMaxAttempts(serverUuid);

    console.log(
      `Server ${serverUuid} crashed. Attempt ${newAttempts}/${maxAttempts}`,
    );

    // If we've reached max attempts, mark the server as ERROR
    if (newAttempts >= maxAttempts) {
      console.warn(
        `Server ${serverUuid} has crashed ${newAttempts} times. Marking as ERROR.`,
      );

      try {
        await this.markServerAsError(serverUuid);

        // Log the crash info
        const crashInfo: ServerCrashInfo = {
          serverUuid,
          exitCode,
          signal,
          timestamp: new Date(),
        };

        console.error(
          "Server marked as ERROR due to repeated crashes:",
          crashInfo,
        );
      } catch (error) {
        console.error(`Failed to mark server ${serverUuid} as ERROR:`, error);
      }
    }
  }

  /**
   * Mark a server as ERROR
   */
  private async markServerAsError(serverUuid: string): Promise<void> {
    try {
      // Update the server-level error status
      await mcpServersRepository.updateServerErrorStatus({
        serverUuid,
        errorStatus: McpServerErrorStatusEnum.Enum.ERROR,
      });

      console.error(`Server ${serverUuid} marked as ERROR at server level`);
    } catch (error) {
      console.error(`Error marking server ${serverUuid} as ERROR:`, error);
    }
  }

  /**
   * Reset crash attempts for a server (e.g., after successful recovery)
   */
  resetServerAttempts(serverUuid: string): void {
    this.crashAttempts.delete(serverUuid);
  }

  /**
   * Get current crash attempts for a server
   */
  getServerAttempts(serverUuid: string): number {
    return this.crashAttempts.get(serverUuid) || 0;
  }

  /**
   * Check if a server is in ERROR state
   */
  async isServerInErrorState(serverUuid: string): Promise<boolean> {
    try {
      const server = await mcpServersRepository.findByUuid(serverUuid);
      return server?.error_status === McpServerErrorStatusEnum.Enum.ERROR;
    } catch (error) {
      console.error(
        `Error checking server error state for ${serverUuid}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Reset error state for a server (e.g., after manual recovery)
   */
  async resetServerErrorState(serverUuid: string): Promise<void> {
    try {
      // Reset crash attempts
      this.resetServerAttempts(serverUuid);

      // Update the database to clear the error status
      await mcpServersRepository.updateServerErrorStatus({
        serverUuid,
        errorStatus: McpServerErrorStatusEnum.Enum.NONE,
      });

      console.log(`Reset error state for server ${serverUuid}`);
    } catch (error) {
      console.error(
        `Error resetting error state for server ${serverUuid}:`,
        error,
      );
    }
  }
}

// Export singleton instance
export const serverErrorTracker = ServerErrorTracker.getInstance();
