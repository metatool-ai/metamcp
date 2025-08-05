import { ServerParameters } from "@repo/zod-types";

import { ConnectedClient, connectMetaMcpClient } from "./client";

export interface McpServerPoolStatus {
  active: number;
  activeServerUuids: string[];
}

export class McpServerPool {
  // Singleton instance
  private static instance: McpServerPool | null = null;

  // Fixed sessions: serverUuid -> ConnectedClient (one per server)
  private fixedSessions: Record<string, ConnectedClient> = {};

  // Server parameters cache: serverUuid -> ServerParameters
  private serverParamsCache: Record<string, ServerParameters> = {};

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): McpServerPool {
    if (!McpServerPool.instance) {
      McpServerPool.instance = new McpServerPool();
    }
    return McpServerPool.instance;
  }

  /**
   * Get or create a fixed session for a specific MCP server
   */
  async getSession(
    sessionId: string,
    serverUuid: string,
    params: ServerParameters,
  ): Promise<ConnectedClient | undefined> {
    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Check if we already have a fixed session for this server
    if (this.fixedSessions[serverUuid]) {
      return this.fixedSessions[serverUuid];
    }

    // Create a new fixed session for this server
    const newClient = await this.createNewConnection(params);
    if (!newClient) {
      return undefined;
    }

    this.fixedSessions[serverUuid] = newClient;

    console.log(
      `Created fixed session for server ${serverUuid}, session ${sessionId}`,
    );

    return newClient;
  }

  /**
   * Create a new connection for a server
   */
  private async createNewConnection(
    params: ServerParameters,
  ): Promise<ConnectedClient | undefined> {
    const connectedClient = await connectMetaMcpClient(params);
    if (!connectedClient) {
      return undefined;
    }

    return connectedClient;
  }

  /**
   * Ensure fixed sessions exist for all servers
   */
  async ensureFixedSessions(
    serverParams: Record<string, ServerParameters>,
  ): Promise<void> {
    const promises = Object.entries(serverParams).map(
      async ([uuid, params]) => {
        if (!this.fixedSessions[uuid]) {
          const newClient = await this.createNewConnection(params);
          if (newClient) {
            this.fixedSessions[uuid] = newClient;
            this.serverParamsCache[uuid] = params;
            console.log(`Created fixed session for server ${uuid}`);
          }
        }
      },
    );

    await Promise.allSettled(promises);
  }

  /**
   * Cleanup a session by sessionId (no-op for fixed sessions)
   */
  async cleanupSession(sessionId: string): Promise<void> {
    // Fixed sessions are not cleaned up by sessionId
    // They persist until the server is invalidated or the pool is cleaned up
    console.log(
      `Session cleanup requested for ${sessionId} (fixed sessions persist)`,
    );
  }

  /**
   * Cleanup all sessions
   */
  async cleanupAll(): Promise<void> {
    // Cleanup all fixed sessions
    await Promise.allSettled(
      Object.entries(this.fixedSessions).map(async ([_uuid, client]) => {
        await client.cleanup();
      }),
    );

    // Clear all state
    this.fixedSessions = {};
    this.serverParamsCache = {};

    console.log("Cleaned up all MCP server fixed sessions");
  }

  /**
   * Get pool status for monitoring
   */
  getPoolStatus(): McpServerPoolStatus {
    const active = Object.keys(this.fixedSessions).length;

    return {
      active,
      activeServerUuids: Object.keys(this.fixedSessions),
    };
  }

  /**
   * Get fixed session connections for a specific session (for debugging/monitoring)
   */
  getSessionConnections(
    sessionId: string,
  ): Record<string, ConnectedClient> | undefined {
    // For fixed sessions, return all active sessions regardless of sessionId
    return this.fixedSessions;
  }

  /**
   * Get all active session IDs (for debugging/monitoring)
   */
  getActiveSessionIds(): string[] {
    // For fixed sessions, return a single session ID representing all fixed sessions
    return Object.keys(this.fixedSessions).length > 0 ? ["fixed-sessions"] : [];
  }

  /**
   * Invalidate and refresh fixed session for a specific server
   * This should be called when a server's parameters (command, args, etc.) change
   */
  async invalidateFixedSession(
    serverUuid: string,
    params: ServerParameters,
  ): Promise<void> {
    console.log(`Invalidating fixed session for server ${serverUuid}`);

    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Cleanup existing fixed session if it exists
    const existingFixedSession = this.fixedSessions[serverUuid];
    if (existingFixedSession) {
      try {
        await existingFixedSession.cleanup();
        console.log(
          `Cleaned up existing fixed session for server ${serverUuid}`,
        );
      } catch (error) {
        console.error(
          `Error cleaning up existing fixed session for server ${serverUuid}:`,
          error,
        );
      }
      delete this.fixedSessions[serverUuid];
    }

    // Create a new fixed session with updated parameters
    const newClient = await this.createNewConnection(params);
    if (newClient) {
      this.fixedSessions[serverUuid] = newClient;
      console.log(`Created new fixed session for server ${serverUuid}`);
    }
  }

  /**
   * Invalidate and refresh fixed sessions for multiple servers
   */
  async invalidateFixedSessions(
    serverParams: Record<string, ServerParameters>,
  ): Promise<void> {
    const promises = Object.entries(serverParams).map(([serverUuid, params]) =>
      this.invalidateFixedSession(serverUuid, params),
    );

    await Promise.allSettled(promises);
  }

  /**
   * Clean up fixed session for a specific server without creating a new one
   * This should be called when a server is being deleted
   */
  async cleanupFixedSession(serverUuid: string): Promise<void> {
    console.log(`Cleaning up fixed session for server ${serverUuid}`);

    // Cleanup existing fixed session if it exists
    const existingFixedSession = this.fixedSessions[serverUuid];
    if (existingFixedSession) {
      try {
        await existingFixedSession.cleanup();
        console.log(`Cleaned up fixed session for server ${serverUuid}`);
      } catch (error) {
        console.error(
          `Error cleaning up fixed session for server ${serverUuid}:`,
          error,
        );
      }
      delete this.fixedSessions[serverUuid];
    }

    // Remove from server params cache
    delete this.serverParamsCache[serverUuid];
  }

  /**
   * Ensure fixed session exists for a newly created server
   * This should be called when a new server is created
   */
  async ensureFixedSessionForNewServer(
    serverUuid: string,
    params: ServerParameters,
  ): Promise<void> {
    console.log(`Ensuring fixed session exists for new server ${serverUuid}`);

    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Only create if we don't already have one
    if (!this.fixedSessions[serverUuid]) {
      const newClient = await this.createNewConnection(params);
      if (newClient) {
        this.fixedSessions[serverUuid] = newClient;
        console.log(`Created fixed session for new server ${serverUuid}`);
      }
    }
  }
}

// Create a singleton instance
export const mcpServerPool = McpServerPool.getInstance();
