import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { mcpServerPool } from "./mcp-server-pool";
import { createServer } from "./metamcp-proxy";

export interface MetaMcpServerInstance {
  server: Server;
  cleanup: () => Promise<void>;
}

export interface MetaMcpServerPoolStatus {
  idle: number;
  active: number;
  activeSessionIds: string[];
  idleNamespaceUuids: string[];
}

export class MetaMcpServerPool {
  // Singleton instance
  private static instance: MetaMcpServerPool | null = null;

  // Idle MetaMCP servers: namespaceUuid -> MetaMcpServerInstance (no sessionId assigned yet)
  private idleServers: Record<string, MetaMcpServerInstance> = {};

  // Active MetaMCP servers: sessionId -> MetaMcpServerInstance
  private activeServers: Record<string, MetaMcpServerInstance> = {};

  // Mapping: sessionId -> namespaceUuid for cleanup tracking
  private sessionToNamespace: Record<string, string> = {};

  // Track ongoing idle server creation to prevent duplicates
  private creatingIdleServers: Set<string> = new Set();

  // Default number of idle servers per namespace UUID
  private readonly defaultIdleCount: number;

  private constructor(defaultIdleCount: number = 1) {
    this.defaultIdleCount = defaultIdleCount;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(defaultIdleCount: number = 1): MetaMcpServerPool {
    if (!MetaMcpServerPool.instance) {
      MetaMcpServerPool.instance = new MetaMcpServerPool(defaultIdleCount);
    }
    return MetaMcpServerPool.instance;
  }

  /**
   * Get or create a MetaMCP server for a namespace
   */
  async getServer(
    sessionId: string,
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): Promise<MetaMcpServerInstance | undefined> {
    // Check if we already have an active server for this sessionId
    if (this.activeServers[sessionId]) {
      return this.activeServers[sessionId];
    }

    // Check if we have an idle server for this namespace that we can convert
    const idleServer = this.idleServers[namespaceUuid];
    if (idleServer) {
      // Convert idle server to active server
      delete this.idleServers[namespaceUuid];
      this.activeServers[sessionId] = idleServer;
      this.sessionToNamespace[sessionId] = namespaceUuid;

      console.log(
        `Converted idle MetaMCP server to active for namespace ${namespaceUuid}, session ${sessionId}`,
      );

      // Create a new idle server to replace the one we just used (ASYNC - NON-BLOCKING)
      this.createIdleServerAsync(namespaceUuid, includeInactiveServers);

      return idleServer;
    }

    // No idle server available, create a new one
    const newServer = await this.createNewServer(
      sessionId,
      namespaceUuid,
      includeInactiveServers,
    );
    if (!newServer) {
      return undefined;
    }

    this.activeServers[sessionId] = newServer;
    this.sessionToNamespace[sessionId] = namespaceUuid;

    console.log(
      `Created new active MetaMCP server for namespace ${namespaceUuid}, session ${sessionId}`,
    );

    // Also create an idle server for future use (ASYNC - NON-BLOCKING)
    this.createIdleServerAsync(namespaceUuid, includeInactiveServers);

    return newServer;
  }

  /**
   * Create a new MetaMCP server instance
   */
  private async createNewServer(
    sessionId: string,
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): Promise<MetaMcpServerInstance | undefined> {
    try {
      // Create the MetaMCP server - MCP server pool is pre-warmed during startup
      const serverInstance = await createServer(
        namespaceUuid,
        sessionId,
        includeInactiveServers,
      );

      return serverInstance;
    } catch (error) {
      console.error(
        `Error creating MetaMCP server for namespace ${namespaceUuid}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Create an idle MetaMCP server for a namespace (blocking version for initial setup)
   */
  private async createIdleServer(
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): Promise<void> {
    // Don't create if we already have an idle server for this namespace
    if (this.idleServers[namespaceUuid]) {
      return;
    }

    // Create a temporary sessionId for the idle server
    const tempSessionId = `idle_${namespaceUuid}_${Date.now()}`;

    const newServer = await this.createNewServer(
      tempSessionId,
      namespaceUuid,
      includeInactiveServers,
    );
    if (newServer) {
      // Wrap the server to handle session ID reassignment when converting from idle to active
      const wrappedServer: MetaMcpServerInstance = {
        server: newServer.server,
        cleanup: newServer.cleanup,
      };

      this.idleServers[namespaceUuid] = wrappedServer;
      console.log(`Created idle MetaMCP server for namespace ${namespaceUuid}`);
    }
  }

  /**
   * Create an idle MetaMCP server for a namespace asynchronously (non-blocking)
   */
  private createIdleServerAsync(
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): void {
    // Don't create if we already have an idle server or are already creating one
    if (
      this.idleServers[namespaceUuid] ||
      this.creatingIdleServers.has(namespaceUuid)
    ) {
      return;
    }

    // Mark that we're creating an idle server for this namespace
    this.creatingIdleServers.add(namespaceUuid);

    // Create the server in the background (fire and forget)
    const tempSessionId = `idle_${namespaceUuid}_${Date.now()}`;

    this.createNewServer(tempSessionId, namespaceUuid, includeInactiveServers)
      .then((newServer) => {
        if (newServer && !this.idleServers[namespaceUuid]) {
          const wrappedServer: MetaMcpServerInstance = {
            server: newServer.server,
            cleanup: newServer.cleanup,
          };
          this.idleServers[namespaceUuid] = wrappedServer;
          console.log(
            `Created background idle MetaMCP server for namespace ${namespaceUuid}`,
          );
        } else if (newServer) {
          // We already have an idle server, cleanup the extra one
          newServer.cleanup().catch((error) => {
            console.error(
              `Error cleaning up extra idle MetaMCP server for ${namespaceUuid}:`,
              error,
            );
          });
        }
      })
      .catch((error) => {
        console.error(
          `Error creating background idle MetaMCP server for ${namespaceUuid}:`,
          error,
        );
      })
      .finally(() => {
        // Remove from creating set
        this.creatingIdleServers.delete(namespaceUuid);
      });
  }

  /**
   * Ensure idle servers exist for all namespaces
   */
  async ensureIdleServers(
    namespaceUuids: string[],
    includeInactiveServers: boolean = false,
  ): Promise<void> {
    const promises = namespaceUuids.map(async (namespaceUuid) => {
      if (!this.idleServers[namespaceUuid]) {
        await this.createIdleServer(namespaceUuid, includeInactiveServers);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Cleanup a session by sessionId
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const activeServer = this.activeServers[sessionId];
    if (!activeServer) {
      return;
    }

    // Cleanup the MetaMCP server
    await activeServer.cleanup();

    // Also cleanup the corresponding MCP server pool session
    await mcpServerPool.cleanupSession(sessionId);

    // Remove from active servers
    delete this.activeServers[sessionId];

    // Get the namespace UUID and create a new idle server if needed
    const namespaceUuid = this.sessionToNamespace[sessionId];
    if (namespaceUuid) {
      // Create a new idle server to replace capacity (ASYNC - NON-BLOCKING)
      this.createIdleServerAsync(namespaceUuid);
      delete this.sessionToNamespace[sessionId];
    }

    console.log(`Cleaned up MetaMCP server pool session ${sessionId}`);
  }

  /**
   * Cleanup all servers
   */
  async cleanupAll(): Promise<void> {
    // Cleanup all active servers
    const activeSessionIds = Object.keys(this.activeServers);
    await Promise.allSettled(
      activeSessionIds.map((sessionId) => this.cleanupSession(sessionId)),
    );

    // Cleanup all idle servers
    await Promise.allSettled(
      Object.entries(this.idleServers).map(async ([_uuid, server]) => {
        await server.cleanup();
      }),
    );

    // Cleanup all MCP server pool sessions
    await mcpServerPool.cleanupAll();

    // Clear all state
    this.idleServers = {};
    this.activeServers = {};
    this.sessionToNamespace = {};
    this.creatingIdleServers.clear();

    console.log("Cleaned up all MetaMCP server pool sessions");
  }

  /**
   * Get pool status for monitoring
   */
  getPoolStatus(): MetaMcpServerPoolStatus {
    const idle = Object.keys(this.idleServers).length;
    const active = Object.keys(this.activeServers).length;

    return {
      idle,
      active,
      activeSessionIds: Object.keys(this.activeServers),
      idleNamespaceUuids: Object.keys(this.idleServers),
    };
  }

  /**
   * Get active server instance for a specific session (for debugging/monitoring)
   */
  getServerInstance(sessionId: string): MetaMcpServerInstance | undefined {
    return this.activeServers[sessionId];
  }

  /**
   * Get all active session IDs (for debugging/monitoring)
   */
  getActiveSessionIds(): string[] {
    return Object.keys(this.activeServers);
  }

  /**
   * Get MCP server pool status
   */
  getMcpServerPoolStatus() {
    return mcpServerPool.getPoolStatus();
  }

  /**
   * Invalidate and refresh idle server for a specific namespace
   * This should be called when a namespace's MCP servers list changes
   */
  async invalidateIdleServer(
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): Promise<void> {
    console.log(`Invalidating idle server for namespace ${namespaceUuid}`);

    // Cleanup existing idle server if it exists
    const existingIdleServer = this.idleServers[namespaceUuid];
    if (existingIdleServer) {
      try {
        await existingIdleServer.cleanup();
        console.log(
          `Cleaned up existing idle server for namespace ${namespaceUuid}`,
        );
      } catch (error) {
        console.error(
          `Error cleaning up existing idle server for namespace ${namespaceUuid}:`,
          error,
        );
      }
      delete this.idleServers[namespaceUuid];
    }

    // Remove from creating set if it's in progress
    this.creatingIdleServers.delete(namespaceUuid);

    // Create a new idle server with updated configuration
    await this.createIdleServer(namespaceUuid, includeInactiveServers);
  }

  /**
   * Invalidate and refresh idle servers for multiple namespaces
   */
  async invalidateIdleServers(
    namespaceUuids: string[],
    includeInactiveServers: boolean = false,
  ): Promise<void> {
    const promises = namespaceUuids.map((namespaceUuid) =>
      this.invalidateIdleServer(namespaceUuid, includeInactiveServers),
    );

    await Promise.allSettled(promises);
  }

  /**
   * Clean up idle server for a specific namespace without creating a new one
   * This should be called when a namespace is being deleted
   */
  async cleanupIdleServer(namespaceUuid: string): Promise<void> {
    console.log(`Cleaning up idle server for namespace ${namespaceUuid}`);

    // Cleanup existing idle server if it exists
    const existingIdleServer = this.idleServers[namespaceUuid];
    if (existingIdleServer) {
      try {
        await existingIdleServer.cleanup();
        console.log(`Cleaned up idle server for namespace ${namespaceUuid}`);
      } catch (error) {
        console.error(
          `Error cleaning up idle server for namespace ${namespaceUuid}:`,
          error,
        );
      }
      delete this.idleServers[namespaceUuid];
    }

    // Remove from creating set if it's in progress
    this.creatingIdleServers.delete(namespaceUuid);
  }

  /**
   * Ensure idle server exists for a newly created namespace
   * This should be called when a new namespace is created
   */
  async ensureIdleServerForNewNamespace(
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): Promise<void> {
    console.log(
      `Ensuring idle server exists for new namespace ${namespaceUuid}`,
    );

    // Only create if we don't already have one
    if (
      !this.idleServers[namespaceUuid] &&
      !this.creatingIdleServers.has(namespaceUuid)
    ) {
      await this.createIdleServer(namespaceUuid, includeInactiveServers);
    }
  }

  /**
   * Get or create a persistent MetaMCP server for OpenAPI endpoints
   * These sessions are never cleaned up automatically and persist until invalidation
   */
  async getOpenApiServer(
    namespaceUuid: string,
    includeInactiveServers: boolean = false,
  ): Promise<MetaMcpServerInstance | undefined> {
    // Use a deterministic session ID for OpenAPI endpoints
    const sessionId = `openapi_${namespaceUuid}`;

    // Check if we already have an active server for this OpenAPI session
    if (this.activeServers[sessionId]) {
      return this.activeServers[sessionId];
    }

    // Check if we have an idle server for this namespace that we can convert
    const idleServer = this.idleServers[namespaceUuid];
    if (idleServer) {
      // Convert idle server to active OpenAPI server
      delete this.idleServers[namespaceUuid];
      this.activeServers[sessionId] = idleServer;
      this.sessionToNamespace[sessionId] = namespaceUuid;

      console.log(
        `Converted idle MetaMCP server to OpenAPI server for namespace ${namespaceUuid}, session ${sessionId}`,
      );

      // Create a new idle server to replace the one we just used (SYNC - BLOCKING)
      await this.createIdleServer(namespaceUuid, includeInactiveServers);

      return idleServer;
    }

    // No idle server available, create a new one
    const newServer = await this.createNewServer(
      sessionId,
      namespaceUuid,
      includeInactiveServers,
    );
    if (!newServer) {
      return undefined;
    }

    this.activeServers[sessionId] = newServer;
    this.sessionToNamespace[sessionId] = namespaceUuid;

    console.log(
      `Created new OpenAPI MetaMCP server for namespace ${namespaceUuid}, session ${sessionId}`,
    );

    // Also create an idle server for future use (SYNC - BLOCKING)
    await this.createIdleServer(namespaceUuid, includeInactiveServers);

    return newServer;
  }

  /**
   * Invalidate OpenAPI sessions for specific namespaces
   * This is called when namespace configurations change
   */
  async invalidateOpenApiSessions(
    namespaceUuids: string[],
    includeInactiveServers: boolean = false,
  ): Promise<void> {
    console.log(
      `Invalidating OpenAPI sessions for namespaces: ${namespaceUuids.join(", ")}`,
    );

    const promises = namespaceUuids.map(async (namespaceUuid) => {
      const sessionId = `openapi_${namespaceUuid}`;

      // Clean up existing OpenAPI session if it exists
      const existingServer = this.activeServers[sessionId];
      if (existingServer) {
        try {
          await existingServer.cleanup();
          console.log(
            `Cleaned up existing OpenAPI session for namespace ${namespaceUuid}`,
          );
        } catch (error) {
          console.error(
            `Error cleaning up OpenAPI session for namespace ${namespaceUuid}:`,
            error,
          );
        }
        delete this.activeServers[sessionId];
        delete this.sessionToNamespace[sessionId];
      }

      // Create a new OpenAPI session with updated configuration
      await this.getOpenApiServer(namespaceUuid, includeInactiveServers);
    });

    await Promise.allSettled(promises);
  }
}

// Create a singleton instance
export const metaMcpServerPool = MetaMcpServerPool.getInstance();
