import { ServerParameters } from "@repo/zod-types";

import { ConnectedClient, connectMetaMcpClient } from "./client";
import { serverErrorTracker } from "./server-error-tracker";

export interface McpServerPoolStatus {
  idle: number;
  active: number;
  activeSessionIds: string[];
  idleServerUuids: string[];
}

export class McpServerPool {
  // Singleton instance
  private static instance: McpServerPool | null = null;

  // Idle sessions: serverUuid -> ConnectedClient (no sessionId assigned yet)
  private idleSessions: Record<string, ConnectedClient> = {};

  // Active sessions: sessionId -> Record<serverUuid, ConnectedClient>
  private activeSessions: Record<string, Record<string, ConnectedClient>> = {};

  // Mapping: sessionId -> Set<serverUuid> for cleanup tracking
  private sessionToServers: Record<string, Set<string>> = {};

  // Server parameters cache: serverUuid -> ServerParameters
  private serverParamsCache: Record<string, ServerParameters> = {};

  // Track ongoing idle session creation to prevent duplicates
  private creatingIdleSessions: Set<string> = new Set();

  // Default number of idle sessions per server UUID
  private readonly defaultIdleCount: number;

  private constructor(defaultIdleCount: number = 1) {
    this.defaultIdleCount = defaultIdleCount;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(defaultIdleCount: number = 1): McpServerPool {
    if (!McpServerPool.instance) {
      McpServerPool.instance = new McpServerPool(defaultIdleCount);
    }
    return McpServerPool.instance;
  }

  /**
   * Get or create a session for a specific MCP server
   */
  async getSession(
    sessionId: string,
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<ConnectedClient | undefined> {
    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Check if we already have an active session for this sessionId and server
    if (this.activeSessions[sessionId]?.[serverUuid]) {
      return this.activeSessions[sessionId][serverUuid];
    }

    // Initialize session if it doesn't exist
    if (!this.activeSessions[sessionId]) {
      this.activeSessions[sessionId] = {};
      this.sessionToServers[sessionId] = new Set();
    }

    // Check if we have an idle session for this server that we can convert
    const idleClient = this.idleSessions[serverUuid];
    if (idleClient) {
      // Convert idle session to active session
      delete this.idleSessions[serverUuid];
      this.activeSessions[sessionId][serverUuid] = idleClient;
      this.sessionToServers[sessionId].add(serverUuid);

      console.log(
        `Converted idle session to active for server ${serverUuid}, session ${sessionId}`,
      );

      // Create a new idle session to replace the one we just used (ASYNC - NON-BLOCKING)
      this.createIdleSessionAsync(serverUuid, params, namespaceUuid);

      return idleClient;
    }

    // No idle session available, create a new connection
    const newClient = await this.createNewConnection(params, namespaceUuid);
    if (!newClient) {
      return undefined;
    }

    this.activeSessions[sessionId][serverUuid] = newClient;
    this.sessionToServers[sessionId].add(serverUuid);

    console.log(
      `Created new active session for server ${serverUuid}, session ${sessionId}`,
    );

    // Also create an idle session for future use (ASYNC - NON-BLOCKING)
    this.createIdleSessionAsync(serverUuid, params, namespaceUuid);

    return newClient;
  }

  /**
   * Create a new connection for a server
   */
  private async createNewConnection(
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<ConnectedClient | undefined> {
    console.log(
      `Creating new connection for server ${params.name} (${params.uuid}) with namespace: ${namespaceUuid || "none"}`,
    );

    const connectedClient = await connectMetaMcpClient(
      params,
      (exitCode, signal) => {
        console.log(
          `Crash handler callback called for server ${params.name} (${params.uuid}) with namespace: ${namespaceUuid || "none"}`,
        );

        // Handle process crash - always set up crash handler
        if (namespaceUuid) {
          // If we have a namespace context, use it
          this.handleServerCrash(
            params.uuid,
            namespaceUuid,
            exitCode,
            signal,
          ).catch((error) => {
            console.error(
              `Error handling server crash for ${params.uuid} in ${namespaceUuid}:`,
              error,
            );
          });
        } else {
          // If no namespace context, still track the crash globally
          this.handleServerCrashWithoutNamespace(
            params.uuid,
            exitCode,
            signal,
          ).catch((error) => {
            console.error(
              `Error handling server crash for ${params.uuid} (no namespace):`,
              error,
            );
          });
        }
      },
    );
    if (!connectedClient) {
      return undefined;
    }

    return connectedClient;
  }

  /**
   * Create an idle session for a server (blocking version for initial setup)
   */
  private async createIdleSession(
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<void> {
    // Don't create if we already have an idle session for this server
    if (this.idleSessions[serverUuid]) {
      return;
    }

    const newClient = await this.createNewConnection(params, namespaceUuid);
    if (newClient) {
      this.idleSessions[serverUuid] = newClient;
      console.log(`Created idle session for server ${serverUuid}`);
    }
  }

  /**
   * Create an idle session for a server asynchronously (non-blocking)
   */
  private createIdleSessionAsync(
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): void {
    // Don't create if we already have an idle session or are already creating one
    if (
      this.idleSessions[serverUuid] ||
      this.creatingIdleSessions.has(serverUuid)
    ) {
      return;
    }

    // Mark that we're creating an idle session for this server
    this.creatingIdleSessions.add(serverUuid);

    // Create the session in the background (fire and forget)
    this.createNewConnection(params, namespaceUuid)
      .then((newClient) => {
        if (newClient && !this.idleSessions[serverUuid]) {
          this.idleSessions[serverUuid] = newClient;
          console.log(
            `Created background idle session for server [${params.name}] ${serverUuid}`,
          );
        } else if (newClient) {
          // We already have an idle session, cleanup the extra one
          newClient.cleanup().catch((error) => {
            console.error(
              `Error cleaning up extra idle session for ${serverUuid}:`,
              error,
            );
          });
        }
      })
      .catch((error) => {
        console.error(
          `Error creating background idle session for ${serverUuid}:`,
          error,
        );
      })
      .finally(() => {
        // Remove from creating set
        this.creatingIdleSessions.delete(serverUuid);
      });
  }

  /**
   * Ensure idle sessions exist for all servers
   */
  async ensureIdleSessions(
    serverParams: Record<string, ServerParameters>,
    namespaceUuid?: string,
  ): Promise<void> {
    const promises = Object.entries(serverParams).map(
      async ([uuid, params]) => {
        if (!this.idleSessions[uuid]) {
          await this.createIdleSession(uuid, params, namespaceUuid);
        }
      },
    );

    await Promise.allSettled(promises);
  }

  /**
   * Cleanup a session by sessionId
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const activeSession = this.activeSessions[sessionId];
    if (!activeSession) {
      return;
    }

    // Cleanup all connections for this session
    await Promise.allSettled(
      Object.entries(activeSession).map(async ([_serverUuid, client]) => {
        await client.cleanup();
      }),
    );

    // Remove from active sessions
    delete this.activeSessions[sessionId];

    // Clean up session to servers mapping
    const serverUuids = this.sessionToServers[sessionId];
    if (serverUuids) {
      // For each server this session was using, create new idle sessions if needed (ASYNC - NON-BLOCKING)
      Array.from(serverUuids).forEach((serverUuid) => {
        const params = this.serverParamsCache[serverUuid];
        if (params) {
          // Note: We don't have namespaceUuid here, so we can't track crashes properly
          // This is a limitation of the current design - we'll need to pass namespaceUuid from the caller
          this.createIdleSessionAsync(serverUuid, params);
        }
      });

      delete this.sessionToServers[sessionId];
    }

    console.log(`Cleaned up MCP server pool session ${sessionId}`);
  }

  /**
   * Cleanup all sessions
   */
  async cleanupAll(): Promise<void> {
    // Cleanup all active sessions
    const activeSessionIds = Object.keys(this.activeSessions);
    await Promise.allSettled(
      activeSessionIds.map((sessionId) => this.cleanupSession(sessionId)),
    );

    // Cleanup all idle sessions
    await Promise.allSettled(
      Object.entries(this.idleSessions).map(async ([_uuid, client]) => {
        await client.cleanup();
      }),
    );

    // Clear all state
    this.idleSessions = {};
    this.activeSessions = {};
    this.sessionToServers = {};
    this.serverParamsCache = {};
    this.creatingIdleSessions.clear();

    console.log("Cleaned up all MCP server pool sessions");
  }

  /**
   * Get pool status for monitoring
   */
  getPoolStatus(): McpServerPoolStatus {
    const idle = Object.keys(this.idleSessions).length;
    const active = Object.keys(this.activeSessions).reduce(
      (total, sessionId) =>
        total + Object.keys(this.activeSessions[sessionId]).length,
      0,
    );

    return {
      idle,
      active,
      activeSessionIds: Object.keys(this.activeSessions),
      idleServerUuids: Object.keys(this.idleSessions),
    };
  }

  /**
   * Get active session connections for a specific session (for debugging/monitoring)
   */
  getSessionConnections(
    sessionId: string,
  ): Record<string, ConnectedClient> | undefined {
    return this.activeSessions[sessionId];
  }

  /**
   * Get all active session IDs (for debugging/monitoring)
   */
  getActiveSessionIds(): string[] {
    return Object.keys(this.activeSessions);
  }

  /**
   * Invalidate and refresh idle session for a specific server
   * This should be called when a server's parameters (command, args, etc.) change
   */
  async invalidateIdleSession(
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<void> {
    console.log(`Invalidating idle session for server ${serverUuid}`);

    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Cleanup existing idle session if it exists
    const existingIdleSession = this.idleSessions[serverUuid];
    if (existingIdleSession) {
      try {
        await existingIdleSession.cleanup();
        console.log(
          `Cleaned up existing idle session for server ${serverUuid}`,
        );
      } catch (error) {
        console.error(
          `Error cleaning up existing idle session for server ${serverUuid}:`,
          error,
        );
      }
      delete this.idleSessions[serverUuid];
    }

    // Remove from creating set if it's in progress
    this.creatingIdleSessions.delete(serverUuid);

    // Create a new idle session with updated parameters
    await this.createIdleSession(serverUuid, params, namespaceUuid);
  }

  /**
   * Invalidate and refresh idle sessions for multiple servers
   */
  async invalidateIdleSessions(
    serverParams: Record<string, ServerParameters>,
    namespaceUuid?: string,
  ): Promise<void> {
    const promises = Object.entries(serverParams).map(([serverUuid, params]) =>
      this.invalidateIdleSession(serverUuid, params, namespaceUuid),
    );

    await Promise.allSettled(promises);
  }

  /**
   * Clean up idle session for a specific server without creating a new one
   * This should be called when a server is being deleted
   */
  async cleanupIdleSession(serverUuid: string): Promise<void> {
    console.log(`Cleaning up idle session for server ${serverUuid}`);

    // Cleanup existing idle session if it exists
    const existingIdleSession = this.idleSessions[serverUuid];
    if (existingIdleSession) {
      try {
        await existingIdleSession.cleanup();
        console.log(`Cleaned up idle session for server ${serverUuid}`);
      } catch (error) {
        console.error(
          `Error cleaning up idle session for server ${serverUuid}:`,
          error,
        );
      }
      delete this.idleSessions[serverUuid];
    }

    // Remove from creating set if it's in progress
    this.creatingIdleSessions.delete(serverUuid);

    // Remove from server params cache
    delete this.serverParamsCache[serverUuid];
  }

  /**
   * Ensure idle session exists for a newly created server
   * This should be called when a new server is created
   */
  async ensureIdleSessionForNewServer(
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<void> {
    console.log(`Ensuring idle session exists for new server ${serverUuid}`);

    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Only create if we don't already have one
    if (
      !this.idleSessions[serverUuid] &&
      !this.creatingIdleSessions.has(serverUuid)
    ) {
      await this.createIdleSession(serverUuid, params, namespaceUuid);
    }
  }

  /**
   * Handle server process crash
   */
  async handleServerCrash(
    serverUuid: string,
    namespaceUuid: string,
    exitCode: number | null,
    signal: string | null,
  ): Promise<void> {
    console.warn(
      `Handling server crash for ${serverUuid} in namespace ${namespaceUuid}`,
    );

    // Record the crash in the error tracker
    await serverErrorTracker.recordServerCrash(serverUuid, exitCode, signal);

    // Clean up any existing sessions for this server
    await this.cleanupServerSessions(serverUuid);
  }

  /**
   * Handle server process crash without namespace context
   * This is used when servers are created without a specific namespace
   */
  async handleServerCrashWithoutNamespace(
    serverUuid: string,
    exitCode: number | null,
    signal: string | null,
  ): Promise<void> {
    console.warn(
      `Handling server crash for ${serverUuid} (no namespace context)`,
    );

    // Record the crash in the error tracker
    console.log(`Recording crash for server ${serverUuid}`);
    await serverErrorTracker.recordServerCrash(serverUuid, exitCode, signal);

    // Clean up any existing sessions for this server
    await this.cleanupServerSessions(serverUuid);
  }

  /**
   * Clean up all sessions for a specific server
   */
  private async cleanupServerSessions(serverUuid: string): Promise<void> {
    // Clean up idle session
    const idleSession = this.idleSessions[serverUuid];
    if (idleSession) {
      try {
        await idleSession.cleanup();
        console.log(`Cleaned up idle session for crashed server ${serverUuid}`);
      } catch (error) {
        console.error(
          `Error cleaning up idle session for crashed server ${serverUuid}:`,
          error,
        );
      }
      delete this.idleSessions[serverUuid];
    }

    // Clean up active sessions that use this server
    for (const [sessionId, sessionServers] of Object.entries(
      this.activeSessions,
    )) {
      if (sessionServers[serverUuid]) {
        try {
          await sessionServers[serverUuid].cleanup();
          console.log(
            `Cleaned up active session ${sessionId} for crashed server ${serverUuid}`,
          );
        } catch (error) {
          console.error(
            `Error cleaning up active session ${sessionId} for crashed server ${serverUuid}:`,
            error,
          );
        }
        delete sessionServers[serverUuid];
        this.sessionToServers[sessionId]?.delete(serverUuid);
      }
    }

    // Remove from creating set
    this.creatingIdleSessions.delete(serverUuid);
  }

  /**
   * Check if a server is in error state
   */
  async isServerInErrorState(serverUuid: string): Promise<boolean> {
    return await serverErrorTracker.isServerInErrorState(serverUuid);
  }

  /**
   * Reset error state for a server (e.g., after manual recovery)
   */
  async resetServerErrorState(serverUuid: string): Promise<void> {
    // Reset crash attempts and error status
    await serverErrorTracker.resetServerErrorState(serverUuid);

    console.log(`Reset error state for server ${serverUuid}`);
  }
}

// Create a singleton instance
export const mcpServerPool = McpServerPool.getInstance();
