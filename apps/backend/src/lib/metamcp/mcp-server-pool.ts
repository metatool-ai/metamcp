import { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import { configService } from "../config.service";
import { ConnectedClient, connectMetaMcpClient } from "./client";
import { serverRequiresForwardedHeaders } from "./header-forwarding";
import { metamcpLogStore } from "./log-store";
import { serverErrorTracker } from "./server-error-tracker";

export interface McpServerPoolStatus {
  idle: number;
  active: number;
  activeSessionIds: string[];
  idleServerUuids: string[];
  perServerCounts?: Record<string, number>;
  maxConnectionsPerServer?: number;
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

  // Session creation timestamps: sessionId -> timestamp
  private sessionTimestamps: Record<string, number> = {};

  // Server parameters cache: serverUuid -> ServerParameters
  private serverParamsCache: Record<string, ServerParameters> = {};

  // Track ongoing idle session creation to prevent duplicate warm connections.
  private creatingIdleSessions: Set<string> = new Set();

  // Active session IDs may lease the same ConnectedClient at the per-server cap.
  // Track leases separately so one session cannot close another session's client.
  private connectionRefCounts = new Map<ConnectedClient, number>();

  // Reserve capacity synchronously before awaiting connection startup.
  private pendingConnectionCounts = new Map<string, number>();
  private pendingConnectionPromises = new Map<
    string,
    Promise<ConnectedClient | undefined>
  >();
  private pendingTotalConnections = 0;

  // Invalidation generations prevent in-flight connects from restoring stale clients.
  private serverConnectionGenerations: Record<string, number> = {};

  // Session cleanup timer
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Health check timer for idle sessions
  private healthCheckTimer: NodeJS.Timeout | null = null;

  // Background idle sessions by namespace: namespaceUuid -> any
  private backgroundIdleSessionsByNamespace: Map<string, Map<string, unknown>> =
    new Map();

  // Default number of idle sessions per server UUID
  private readonly defaultIdleCount: number;

  // Maximum total connections (idle + active) to prevent runaway process spawning
  private readonly maxTotalConnections: number;

  // Maximum connections per individual server UUID (prevents per-server process explosion)
  private readonly maxConnectionsPerServer: number;

  private constructor(
    defaultIdleCount: number = 1,
    maxTotalConnections: number = parseInt(
      process.env.MAX_TOTAL_CONNECTIONS || "100",
      10,
    ),
    maxConnectionsPerServer: number = 5,
  ) {
    this.defaultIdleCount = defaultIdleCount;
    this.maxTotalConnections = maxTotalConnections;
    this.maxConnectionsPerServer = maxConnectionsPerServer;
    this.startCleanupTimer();
    this.startHealthCheckTimer();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(
    defaultIdleCount: number = 1,
    maxConnectionsPerServer: number = 5,
  ): McpServerPool {
    if (!McpServerPool.instance) {
      const envMax = parseInt(process.env.MAX_TOTAL_CONNECTIONS || "", 10);
      const maxConn = Number.isFinite(envMax) && envMax > 0 ? envMax : 100;
      McpServerPool.instance = new McpServerPool(
        defaultIdleCount,
        maxConn,
        maxConnectionsPerServer,
      );
    }
    return McpServerPool.instance;
  }

  /**
   * Count all connections (idle + active + pending) for a specific server UUID
   */
  private countConnectionsForServer(serverUuid: string): number {
    // Count unique physical clients, not their session-map references.
    const clients = new Set<ConnectedClient>();
    const idleClient = this.idleSessions[serverUuid];
    if (idleClient) clients.add(idleClient);
    for (const sessionServers of Object.values(this.activeSessions)) {
      const client = sessionServers[serverUuid];
      if (client) clients.add(client);
    }
    return clients.size + (this.pendingConnectionCounts.get(serverUuid) ?? 0);
  }

  private retainConnection(client: ConnectedClient): void {
    this.connectionRefCounts.set(
      client,
      (this.connectionRefCounts.get(client) ?? 1) + 1,
    );
  }

  /** Release one active-session lease and return the number of remaining leases. */
  private releaseConnection(client: ConnectedClient): number {
    const remaining = (this.connectionRefCounts.get(client) ?? 1) - 1;
    if (remaining <= 0) {
      this.connectionRefCounts.delete(client);
      return 0;
    }
    this.connectionRefCounts.set(client, remaining);
    return remaining;
  }

  private reserveConnection(serverUuid: string): boolean {
    if (
      !this.canCreateConnectionForServer(serverUuid) ||
      !this.canCreateConnection()
    ) {
      return false;
    }
    this.pendingConnectionCounts.set(
      serverUuid,
      (this.pendingConnectionCounts.get(serverUuid) ?? 0) + 1,
    );
    this.pendingTotalConnections += 1;
    return true;
  }

  private releaseConnectionReservation(serverUuid: string): void {
    const remaining = (this.pendingConnectionCounts.get(serverUuid) ?? 1) - 1;
    if (remaining <= 0) this.pendingConnectionCounts.delete(serverUuid);
    else this.pendingConnectionCounts.set(serverUuid, remaining);
    this.pendingTotalConnections = Math.max(
      0,
      this.pendingTotalConnections - 1,
    );
  }

  /**
   * Check if we can create another connection for a specific server
   */
  private canCreateConnectionForServer(serverUuid: string): boolean {
    const count = this.countConnectionsForServer(serverUuid);
    if (count >= this.maxConnectionsPerServer) {
      logger.warn(
        `Per-server connection limit reached for ${serverUuid}: ${count}/${this.maxConnectionsPerServer}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Find the oldest active connection for a server UUID (for reuse when at cap)
   */
  private findOldestActiveConnectionForServer(
    serverUuid: string,
  ): ConnectedClient | undefined {
    let oldestSessionId: string | undefined;
    let oldestTimestamp = Infinity;

    for (const [sessionId, sessionServers] of Object.entries(
      this.activeSessions,
    )) {
      if (sessionServers[serverUuid]) {
        const timestamp = this.sessionTimestamps[sessionId] || Infinity;
        if (timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
          oldestSessionId = sessionId;
        }
      }
    }

    if (oldestSessionId) {
      return this.activeSessions[oldestSessionId]?.[serverUuid];
    }
    return undefined;
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
      // Touch timestamp on every access so SESSION_LIFETIME acts as idle timeout, not hard TTL
      this.sessionTimestamps[sessionId] = Date.now();
      return this.activeSessions[sessionId][serverUuid];
    }

    // Initialize session if it doesn't exist
    if (!this.activeSessions[sessionId]) {
      this.activeSessions[sessionId] = {};
      this.sessionToServers[sessionId] = new Set();
      this.sessionTimestamps[sessionId] = Date.now();
    }

    // Check if we have an idle session for this server that we can convert.
    // Skip idle reuse for servers with forward_headers since each client may
    // need unique credentials forwarded to the backend MCP server.
    if (!serverRequiresForwardedHeaders(params)) {
      const idleClient = this.idleSessions[serverUuid];
      if (idleClient) {
        // Convert idle session to active session
        delete this.idleSessions[serverUuid];
        this.connectionRefCounts.set(idleClient, 1);
        this.activeSessions[sessionId][serverUuid] = idleClient;
        this.sessionToServers[sessionId].add(serverUuid);

        logger.info(
          `Converted idle session to active for server ${serverUuid}, session ${sessionId}`,
        );

        // Create a new idle session to replace the one we just used (ASYNC - NON-BLOCKING)
        this.createIdleSessionAsync(serverUuid, params, namespaceUuid);

        return idleClient;
      }
    }

    // Coalesce concurrent startup for the same server. A tools/list fan-out
    // can create many client sessions at once; they should lease the first
    // in-flight connection rather than fail while it is still connecting.
    if (!serverRequiresForwardedHeaders(params)) {
      const pending = this.pendingConnectionPromises.get(serverUuid);
      if (pending) {
        const generation = this.serverConnectionGenerations[serverUuid] ?? 0;
        const pendingClient = await pending;
        if (
          (this.serverConnectionGenerations[serverUuid] ?? 0) !== generation ||
          !this.activeSessions[sessionId]
        ) {
          return undefined;
        }
        if (this.activeSessions[sessionId]?.[serverUuid]) {
          return this.activeSessions[sessionId][serverUuid];
        }
        if (pendingClient) {
          const isIdleClient = this.idleSessions[serverUuid] === pendingClient;
          const hasActiveLease =
            (this.connectionRefCounts.get(pendingClient) ?? 0) > 0;
          if (isIdleClient) {
            // The original request may have closed and recycled the client
            // before this waiter resumed. Take it out of idle before leasing.
            delete this.idleSessions[serverUuid];
            this.connectionRefCounts.set(pendingClient, 1);
          } else if (hasActiveLease) {
            this.retainConnection(pendingClient);
          }
          if (isIdleClient || hasActiveLease) {
            this.activeSessions[sessionId][serverUuid] = pendingClient;
            this.sessionToServers[sessionId].add(serverUuid);
            return pendingClient;
          }
          // The owner discarded this connection (e.g. its client session closed
          // during startup). Do not hand a closed transport to another session;
          // fall through and establish a fresh one.
        }
      }
    }

    // No idle session available — check per-server cap before spawning
    if (!this.canCreateConnectionForServer(serverUuid)) {
      // Never share a connection that carries per-client forwarded credentials.
      const reusable = serverRequiresForwardedHeaders(params)
        ? undefined
        : this.findOldestActiveConnectionForServer(serverUuid);
      if (reusable) {
        logger.info(
          `Reusing existing connection for server ${serverUuid} (at per-server cap ${this.maxConnectionsPerServer})`,
        );
        this.retainConnection(reusable);
        this.activeSessions[sessionId][serverUuid] = reusable;
        this.sessionToServers[sessionId].add(serverUuid);
        return reusable;
      }
      return undefined;
    }

    const generation = this.serverConnectionGenerations[serverUuid] ?? 0;
    const connectionPromise = this.createNewConnection(params, namespaceUuid);
    const canShareConnection = !serverRequiresForwardedHeaders(params);
    if (canShareConnection) {
      this.pendingConnectionPromises.set(serverUuid, connectionPromise);
    }
    let newClient: ConnectedClient | undefined;
    try {
      newClient = await connectionPromise;
    } finally {
      if (
        this.pendingConnectionPromises.get(serverUuid) === connectionPromise
      ) {
        this.pendingConnectionPromises.delete(serverUuid);
      }
    }
    if (!newClient) {
      // Capacity may have been consumed by a concurrent request. Reuse an
      // already-active compatible connection rather than dropping this server.
      const reusable = serverRequiresForwardedHeaders(params)
        ? undefined
        : this.findOldestActiveConnectionForServer(serverUuid);
      if (reusable) {
        this.retainConnection(reusable);
        this.activeSessions[sessionId][serverUuid] = reusable;
        this.sessionToServers[sessionId].add(serverUuid);
        return reusable;
      }
      return undefined;
    }

    if (
      (this.serverConnectionGenerations[serverUuid] ?? 0) !== generation ||
      !this.activeSessions[sessionId]
    ) {
      await newClient.cleanup().catch((error) => {
        logger.error(
          `Error cleaning up stale connection for ${serverUuid}/${sessionId}:`,
          error,
        );
      });
      return undefined;
    }

    // Re-check after the async gap: a concurrent getSession() call for the same
    // (sessionId, serverUuid) pair may have stored a connection while we were awaiting
    // createNewConnection(). If so, discard ours to avoid leaking the spawned process.
    if (this.activeSessions[sessionId]?.[serverUuid]) {
      newClient.cleanup().catch((error) => {
        logger.error(
          `Error cleaning up duplicate connection for server ${params.uuid}:`,
          error,
        );
      });
      return this.activeSessions[sessionId][serverUuid];
    }

    this.connectionRefCounts.set(newClient, 1);
    this.activeSessions[sessionId][serverUuid] = newClient;
    this.sessionToServers[sessionId].add(serverUuid);

    logger.info(
      `Created new active session for server ${serverUuid}, session ${sessionId}`,
    );

    // Only pre-warm idle pool for servers that don't require forwarded headers.
    // Idle sessions are created without per-client headers, so they can't be
    // reused when per-client header forwarding is configured.
    if (!serverRequiresForwardedHeaders(params)) {
      this.createIdleSessionAsync(serverUuid, params, namespaceUuid);
    }

    return newClient;
  }

  /**
   * Create a new connection for a server
   */
  private async createNewConnection(
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<ConnectedClient | undefined> {
    // Reserve global and per-server capacity synchronously before the first await.
    if (!this.reserveConnection(params.uuid)) {
      logger.warn(
        `Skipping connection for server ${params.name} (${params.uuid}) - connection capacity reached`,
      );
      return undefined;
    }

    const generation = this.serverConnectionGenerations[params.uuid] ?? 0;
    try {
      logger.info(
        `Creating new connection for server ${params.name} (${params.uuid}) with namespace: ${namespaceUuid || "none"}`,
      );
      metamcpLogStore.addLog(
        params.name,
        "info",
        `Creating new connection for namespace ${namespaceUuid || "none"}`,
      );

      const connectedClient = await connectMetaMcpClient(
        params,
        (exitCode, signal) => {
          logger.info(
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
              logger.error(
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
              logger.error(
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

      if ((this.serverConnectionGenerations[params.uuid] ?? 0) !== generation) {
        await connectedClient.cleanup().catch((error) => {
          logger.error(
            `Error cleaning up stale connection for ${params.uuid}:`,
            error,
          );
        });
        return undefined;
      }

      return connectedClient;
    } finally {
      this.releaseConnectionReservation(params.uuid);
    }
  }

  /**
   * Create an idle session for a server (blocking version for initial setup)
   */
  private async createIdleSession(
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<void> {
    // Don't create if we already have an idle session or are already creating one.
    // Both checks are synchronous (before any await) so they act as a pre-await
    // mutex, matching the pattern used by createIdleSessionAsync.
    if (
      this.idleSessions[serverUuid] ||
      this.creatingIdleSessions.has(serverUuid)
    ) {
      return;
    }

    // Don't create if at per-server cap
    if (!this.canCreateConnectionForServer(serverUuid)) {
      return;
    }

    this.creatingIdleSessions.add(serverUuid);
    const generation = this.serverConnectionGenerations[serverUuid] ?? 0;

    try {
      const newClient = await this.createNewConnection(params, namespaceUuid);
      if (newClient) {
        const currentGeneration =
          this.serverConnectionGenerations[serverUuid] ?? 0;
        if (
          !this.idleSessions[serverUuid] &&
          currentGeneration === generation
        ) {
          this.idleSessions[serverUuid] = newClient;
          logger.info(`Created idle session for server ${serverUuid}`);
          metamcpLogStore.addLog(
            params.name,
            "info",
            `Created idle session for server ${serverUuid}`,
          );
        } else {
          // Either a concurrent call already stored an idle session, or
          // invalidateIdleSession() bumped the generation while we were awaiting,
          // meaning our result is stale. Discard it.
          newClient.cleanup().catch((error) => {
            logger.error(
              `Error cleaning up duplicate idle session for ${serverUuid}:`,
              error,
            );
          });
        }
      }
    } finally {
      // Only release the guard if we're still the current creation for this
      // server. If the generation was bumped while we were awaiting (e.g. by
      // invalidateIdleSession), the guard now belongs to the newer creation
      // and must not be removed here.
      if ((this.serverConnectionGenerations[serverUuid] ?? 0) === generation) {
        this.creatingIdleSessions.delete(serverUuid);
      }
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

    // Check per-server cap before spawning a background idle
    if (!this.canCreateConnectionForServer(serverUuid)) {
      return;
    }

    // Mark that we're creating an idle session for this server
    this.creatingIdleSessions.add(serverUuid);
    const generation = this.serverConnectionGenerations[serverUuid] ?? 0;

    // Create the session in the background (fire and forget)
    this.createNewConnection(params, namespaceUuid)
      .then((newClient) => {
        const currentGeneration =
          this.serverConnectionGenerations[serverUuid] ?? 0;
        if (
          newClient &&
          !this.idleSessions[serverUuid] &&
          currentGeneration === generation
        ) {
          this.idleSessions[serverUuid] = newClient;
          logger.info(
            `Created background idle session for server [${params.name}] ${serverUuid}`,
          );
          metamcpLogStore.addLog(
            params.name,
            "info",
            `Created background idle session for server ${serverUuid}`,
          );
          if (namespaceUuid) {
            this.setBackgroundIdleSessionsByNamespace(
              namespaceUuid,
              new Map().set("status", "created"),
            );
          }
        } else if (newClient) {
          // Either we already have an idle session, or invalidateIdleSession()
          // bumped the generation while we were awaiting (stale result). Discard it.
          newClient.cleanup().catch((error) => {
            logger.error(
              `Error cleaning up extra idle session for ${serverUuid}:`,
              error,
            );
          });
        }
      })
      .catch((error) => {
        logger.error(
          `Error creating background idle session for ${serverUuid}:`,
          error,
        );
      })
      .finally(() => {
        // Only release the guard if we're still the current creation for this
        // server. If the generation was bumped while we were awaiting (e.g. by
        // invalidateIdleSession), the guard now belongs to the newer creation
        // and must not be removed here.
        if (
          (this.serverConnectionGenerations[serverUuid] ?? 0) === generation
        ) {
          this.creatingIdleSessions.delete(serverUuid);
        }
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
   * Cleanup a session by sessionId.
   * Recycles healthy connections back to the idle pool instead of destroying them.
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const activeSession = this.activeSessions[sessionId];
    if (!activeSession) return;

    // Detach synchronously before awaiting cleanup. HTTP close/finish/delete
    // paths can overlap; deleting first makes this operation idempotent.
    delete this.activeSessions[sessionId];
    delete this.sessionTimestamps[sessionId];
    delete this.sessionToServers[sessionId];

    let recycled = 0;
    let destroyed = 0;
    for (const [serverUuid, client] of Object.entries(activeSession)) {
      if (this.releaseConnection(client) > 0) continue;
      if (!this.idleSessions[serverUuid]) {
        this.idleSessions[serverUuid] = client;
        recycled++;
        logger.info(
          `Recycled active connection for server ${serverUuid} to idle pool (session ${sessionId})`,
        );
      } else {
        try {
          await client.cleanup();
        } catch (error) {
          logger.error(
            `Error cleaning up extra connection for server ${serverUuid}:`,
            error,
          );
        }
        destroyed++;
      }
    }
    logger.info(
      `Cleaned up session ${sessionId} (recycled: ${recycled}, destroyed: ${destroyed})`,
    );
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
    this.sessionTimestamps = {};
    this.serverParamsCache = {};
    this.connectionRefCounts.clear();
    this.pendingConnectionPromises.clear();

    // Bump all known generations (never reset to {}) so any in-flight idle
    // creation that started before cleanupAll() resolves with a stale value
    // and discards itself. Cover both tracked entries and UUIDs that are only
    // in creatingIdleSessions (which default to 0 and have no map entry yet).
    for (const uuid of new Set([
      ...Object.keys(this.serverConnectionGenerations),
      ...this.creatingIdleSessions,
      ...this.pendingConnectionCounts.keys(),
    ])) {
      this.serverConnectionGenerations[uuid] =
        (this.serverConnectionGenerations[uuid] ?? 0) + 1;
    }
    this.creatingIdleSessions.clear();

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    logger.info("Cleaned up all MCP server pool sessions");
  }

  /**
   * Get pool status for monitoring
   */
  getPoolStatus(): McpServerPoolStatus {
    const idle = Object.keys(this.idleSessions).length;
    const activeClients = new Set<ConnectedClient>();
    for (const sessionServers of Object.values(this.activeSessions)) {
      for (const client of Object.values(sessionServers))
        activeClients.add(client);
    }
    const active = activeClients.size;

    // Calculate per-server breakdown
    const perServerCounts: Record<string, number> = {};
    for (const serverUuid of Object.keys(this.serverParamsCache)) {
      perServerCounts[serverUuid] = this.countConnectionsForServer(serverUuid);
    }

    return {
      idle,
      active,
      activeSessionIds: Object.keys(this.activeSessions),
      idleServerUuids: Object.keys(this.idleSessions),
      perServerCounts,
      maxConnectionsPerServer: this.maxConnectionsPerServer,
    };
  }

  /**
   * Get total connection count (idle + active + pending)
   */
  private getTotalConnectionCount(): number {
    const clients = new Set<ConnectedClient>();
    for (const client of Object.values(this.idleSessions)) clients.add(client);
    for (const sessionServers of Object.values(this.activeSessions)) {
      for (const client of Object.values(sessionServers)) clients.add(client);
    }
    return clients.size + this.pendingTotalConnections;
  }

  /**
   * Check if we can create a new connection (respects maxTotalConnections limit)
   */
  private canCreateConnection(): boolean {
    const total = this.getTotalConnectionCount();
    if (total >= this.maxTotalConnections) {
      logger.warn(
        `Connection limit reached: ${total}/${this.maxTotalConnections}. Refusing to create new connection.`,
      );
      return false;
    }
    return true;
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
   * Get background idle sessions by namespace
   */
  getBackgroundIdleSessionsByNamespace(): Map<string, Map<string, unknown>> {
    return this.backgroundIdleSessionsByNamespace;
  }

  /**
   * Set background idle sessions by namespace
   */
  setBackgroundIdleSessionsByNamespace(
    namespaceUuid: string,
    options: Map<string, unknown>,
  ): void {
    this.backgroundIdleSessionsByNamespace.set(namespaceUuid, options);
  }

  /**
   * Drop the pooled backend connection(s) for a given serverUuid.
   *
   * Used when a backend MCP server reports our Mcp-Session-Id is unknown
   * or our transport is dead (e.g. after the backend container restarts and
   * loses its in-memory session registry, or a Watchtower swap kills the
   * socket). No replacement is created here; the next `getSession` call
   * establishes a fresh connection (and therefore a fresh backend session)
   * on demand.
   *
   * The invalidation CASCADES across every session's slot for the affected
   * serverUuid, not just the triggering session's slot, plus the idle slot.
   * When a backend container restarts, EVERY cached ConnectedClient for that
   * serverUuid is dead — stale clients left in sibling sessions' slots for
   * the same backend would defeat a single-slot invalidation: a later
   * `getSession` for one of those siblings would hand back a dead client and
   * the retry would fail with the same envelope that triggered recovery. So
   * we drop them all.
   */
  async invalidateServerConnection(
    sessionId: string,
    serverUuid: string,
  ): Promise<void> {
    this.serverConnectionGenerations[serverUuid] =
      (this.serverConnectionGenerations[serverUuid] ?? 0) + 1;
    this.pendingConnectionPromises.delete(serverUuid);
    const clients = new Set<ConnectedClient>();
    for (const [sid, sessionServers] of Object.entries(this.activeSessions)) {
      const client = sessionServers[serverUuid];
      if (!client) continue;
      clients.add(client);
      delete sessionServers[serverUuid];
      this.sessionToServers[sid]?.delete(serverUuid);
    }
    const idleClient = this.idleSessions[serverUuid];
    if (idleClient) {
      clients.add(idleClient);
      delete this.idleSessions[serverUuid];
    }
    this.creatingIdleSessions.delete(serverUuid);
    for (const client of clients) this.connectionRefCounts.delete(client);
    await Promise.allSettled(
      Array.from(clients, async (client) => {
        try {
          await client.cleanup();
        } catch (error) {
          logger.error(
            `Error cleaning up invalidated connection for ${serverUuid}:`,
            error,
          );
        }
      }),
    );
    logger.warn(
      `Invalidated ${clients.size} pooled backend connection(s) for server ${serverUuid} (triggered by session ${sessionId})`,
    );
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
    logger.info(
      `Invalidating all pooled sessions for updated server ${serverUuid}`,
    );
    this.serverParamsCache[serverUuid] = params;
    await this.invalidateServerConnection(
      "server-configuration-updated",
      serverUuid,
    );
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
    logger.info(
      `Cleaning up all pooled sessions for deleted server ${serverUuid}`,
    );
    await this.invalidateServerConnection("server-deleted", serverUuid);
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
    logger.info(`Ensuring idle session exists for new server ${serverUuid}`);

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
    logger.warn(
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
    logger.warn(
      `Handling server crash for ${serverUuid} (no namespace context)`,
    );

    // Record the crash in the error tracker
    logger.info(`Recording crash for server ${serverUuid}`);
    await serverErrorTracker.recordServerCrash(serverUuid, exitCode, signal);

    // Clean up any existing sessions for this server
    await this.cleanupServerSessions(serverUuid);
  }

  /**
   * Clean up all sessions for a specific server
   */
  private async cleanupServerSessions(serverUuid: string): Promise<void> {
    this.serverConnectionGenerations[serverUuid] =
      (this.serverConnectionGenerations[serverUuid] ?? 0) + 1;
    this.pendingConnectionPromises.delete(serverUuid);
    this.creatingIdleSessions.delete(serverUuid);
    const clients = new Set<ConnectedClient>();
    const idleSession = this.idleSessions[serverUuid];
    if (idleSession) {
      clients.add(idleSession);
      delete this.idleSessions[serverUuid];
    }
    for (const [sessionId, sessionServers] of Object.entries(
      this.activeSessions,
    )) {
      const client = sessionServers[serverUuid];
      if (!client) continue;
      clients.add(client);
      delete sessionServers[serverUuid];
      this.sessionToServers[sessionId]?.delete(serverUuid);
    }
    for (const client of clients) this.connectionRefCounts.delete(client);
    await Promise.allSettled(
      Array.from(clients, async (client) => {
        try {
          await client.cleanup();
        } catch (error) {
          logger.error(
            `Error cleaning up crashed server ${serverUuid}:`,
            error,
          );
        }
      }),
    );
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

    logger.info(`Reset error state for server ${serverUuid}`);
  }

  /**
   * Start the automatic cleanup timer for expired sessions
   */
  private startCleanupTimer(): void {
    // Check for expired sessions every 5 minutes
    this.cleanupTimer = setInterval(
      async () => {
        await this.cleanupExpiredSessions();
      },
      5 * 60 * 1000,
    ); // 5 minutes
  }

  /**
   * Clean up expired sessions based on session lifetime setting
   */
  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const sessionLifetime = await configService.getSessionLifetime();

      // If session lifetime is null, sessions are infinite - skip cleanup
      if (sessionLifetime === null) {
        return;
      }

      const now = Date.now();
      const expiredSessionIds: string[] = [];

      // Find expired sessions
      for (const [sessionId, timestamp] of Object.entries(
        this.sessionTimestamps,
      )) {
        if (now - timestamp > sessionLifetime) {
          expiredSessionIds.push(sessionId);
        }
      }

      // Clean up expired sessions
      if (expiredSessionIds.length > 0) {
        logger.info(
          `Cleaning up ${expiredSessionIds.length} expired MCP server pool sessions: ${expiredSessionIds.join(", ")}`,
        );

        await Promise.allSettled(
          expiredSessionIds.map((sessionId) => this.cleanupSession(sessionId)),
        );
      }
    } catch (error) {
      logger.error("Error during automatic session cleanup:", error);
    }
  }

  /**
   * Start the health check timer for idle sessions
   */
  private startHealthCheckTimer(): void {
    // Check idle session health every 60 seconds
    this.healthCheckTimer = setInterval(async () => {
      await this.checkIdleSessionHealth();
    }, 60 * 1000); // 60 seconds
  }

  /**
   * Check health of idle sessions by pinging them.
   * Dead sessions are cleaned up and recreated.
   * Servers in ERROR state whose crash counters have been reset are retried.
   */
  private async checkIdleSessionHealth(): Promise<void> {
    const serverUuids = Object.keys(this.idleSessions);
    if (serverUuids.length === 0) {
      return;
    }

    for (const serverUuid of serverUuids) {
      const client = this.idleSessions[serverUuid];
      if (!client) continue;

      try {
        // Ping with a 5-second timeout
        await client.client.ping({ timeout: 5000 });
      } catch {
        logger.warn(
          `Idle session health check failed for server ${serverUuid}, recreating...`,
        );

        // A request may have leased this idle client while ping() was in flight.
        if (this.idleSessions[serverUuid] !== client) continue;
        delete this.idleSessions[serverUuid];
        try {
          await client.cleanup();
        } catch {
          // Already dead, ignore cleanup errors
        }

        // Reset error state so we can retry
        await serverErrorTracker.resetServerErrorState(serverUuid);

        // Recreate if we have cached params
        const params = this.serverParamsCache[serverUuid];
        if (params) {
          this.createIdleSessionAsync(serverUuid, params);
        }
      }
    }

    // Also check for servers in ERROR state that have cached params but no idle session.
    // If they were reset (e.g., on startup), we should try to recreate them.
    for (const [serverUuid, params] of Object.entries(this.serverParamsCache)) {
      if (
        !this.idleSessions[serverUuid] &&
        !this.creatingIdleSessions.has(serverUuid)
      ) {
        const isError =
          await serverErrorTracker.isServerInErrorState(serverUuid);
        if (!isError) {
          // Not in error and no idle session - try to create one
          this.createIdleSessionAsync(serverUuid, params);
        }
      }
    }
  }

  /**
   * Get session age in milliseconds
   */
  getSessionAge(sessionId: string): number | undefined {
    const timestamp = this.sessionTimestamps[sessionId];
    return timestamp ? Date.now() - timestamp : undefined;
  }

  /**
   * Check if a session is expired
   */
  async isSessionExpired(sessionId: string): Promise<boolean> {
    const age = this.getSessionAge(sessionId);
    if (age === undefined) return false;

    const sessionLifetime = await configService.getSessionLifetime();
    if (sessionLifetime === null) return false; // infinite sessions
    return age > sessionLifetime;
  }
}

// Create a singleton instance
export const mcpServerPool = McpServerPool.getInstance();
