import { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import { configService } from "../config.service";
import { nonNegativeIntFromEnv } from "../session-lifetime-manager";
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

export interface McpServerPoolOptions {
  /**
   * Keep one started, unused connection per server so that the next client
   * gets it at once (MCP_WARM_POOL). Otherwise connections open on first use.
   */
  warmPool: boolean;
  /**
   * Close a connection nobody used for this long, in ms
   * (MCP_CONNECTION_IDLE_TTL). 0 keeps connections until their client
   * session ends.
   */
  connectionIdleTtlMs: number;
  /** Ceiling on all connections, idle and active (MAX_TOTAL_CONNECTIONS). */
  maxTotalConnections: number;
  /** Ceiling on the connections of one server (MAX_CONNECTIONS_PER_SERVER). */
  maxConnectionsPerServer: number;
}

export function poolOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): McpServerPoolOptions {
  return {
    warmPool: env.MCP_WARM_POOL === "true",
    connectionIdleTtlMs: nonNegativeIntFromEnv(
      env.MCP_CONNECTION_IDLE_TTL,
      15 * 60 * 1000,
    ),
    maxTotalConnections:
      nonNegativeIntFromEnv(env.MAX_TOTAL_CONNECTIONS, 100) || 100,
    maxConnectionsPerServer:
      nonNegativeIntFromEnv(env.MAX_CONNECTIONS_PER_SERVER, 5) || 5,
  };
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

  // Last activity of each session: sessionId -> timestamp
  private sessionTimestamps: Record<string, number> = {};

  // Last use of each connection of a session: sessionId -> serverUuid -> timestamp
  private connectionLastUsed: Record<string, Record<string, number>> = {};

  // Client requests in flight per session (see trackRequest)
  private sessionRequests: Map<string, number> = new Map();

  // When each idle connection was parked
  private idleSince: WeakMap<ConnectedClient, number> = new WeakMap();

  // Server parameters cache: serverUuid -> ServerParameters
  private serverParamsCache: Record<string, ServerParameters> = {};

  // Track ongoing idle session creation to prevent duplicates
  private creatingIdleSessions: Set<string> = new Set();

  // Generation counter per server UUID: incremented by invalidateIdleSession() so
  // any in-flight createIdleSession / createIdleSessionAsync that resolves with a
  // stale generation knows to discard its result instead of storing it.
  private idleSessionGenerations: Record<string, number> = {};

  // Session cleanup timer
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Health check timer for idle sessions
  private healthCheckTimer: NodeJS.Timeout | null = null;

  // Background idle sessions by namespace: namespaceUuid -> any
  private backgroundIdleSessionsByNamespace: Map<string, Map<string, unknown>> =
    new Map();

  // Keep a spare connection per server, replaced as soon as it is taken
  private readonly warmPool: boolean;

  // Close connections unused for this long (ms); 0 disables
  private readonly connectionIdleTtlMs: number;

  // Maximum total connections (idle + active) to prevent runaway process spawning
  private readonly maxTotalConnections: number;

  // Maximum connections per individual server UUID (prevents per-server process explosion)
  private readonly maxConnectionsPerServer: number;

  constructor(options: McpServerPoolOptions = poolOptionsFromEnv()) {
    this.warmPool = options.warmPool;
    this.connectionIdleTtlMs = options.connectionIdleTtlMs;
    this.maxTotalConnections = options.maxTotalConnections;
    this.maxConnectionsPerServer = options.maxConnectionsPerServer;
    this.startCleanupTimer();
    this.startHealthCheckTimer();
  }

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
   * Whether the pool keeps a started spare connection per server (warm
   * pool) rather than opening connections on first use.
   */
  get isWarm(): boolean {
    return this.warmPool;
  }

  /**
   * Distinct clients the active sessions hold for a server. At the
   * per-server cap several sessions may share one.
   */
  private activeClientsForServer(serverUuid: string): Set<ConnectedClient> {
    const clients = new Set<ConnectedClient>();
    for (const sessionServers of Object.values(this.activeSessions)) {
      const client = sessionServers[serverUuid];
      if (client) {
        clients.add(client);
      }
    }
    return clients;
  }

  /**
   * Count all connections (idle + active + pending) for a specific server UUID
   */
  private countConnectionsForServer(serverUuid: string): number {
    let count = this.activeClientsForServer(serverUuid).size;

    // Count idle session
    if (this.idleSessions[serverUuid]) {
      count += 1;
    }

    // Count pending idle creation
    if (this.creatingIdleSessions.has(serverUuid)) {
      count += 1;
    }

    return count;
  }

  /** Whether an active session still holds this client. */
  private isHeldBySession(client: ConnectedClient): boolean {
    return Object.values(this.activeSessions).some((sessionServers) =>
      Object.values(sessionServers).includes(client),
    );
  }

  private setIdle(serverUuid: string, client: ConnectedClient): void {
    this.idleSessions[serverUuid] = client;
    this.idleSince.set(client, Date.now());
  }

  private takeIdle(serverUuid: string): ConnectedClient | undefined {
    const client = this.idleSessions[serverUuid];
    if (client) {
      delete this.idleSessions[serverUuid];
      this.idleSince.delete(client);
    }
    return client;
  }

  private markUsed(sessionId: string, serverUuid: string): void {
    const now = Date.now();
    this.sessionTimestamps[sessionId] = now;
    (this.connectionLastUsed[sessionId] ??= {})[serverUuid] = now;
  }

  /** Gives a connection to a session, creating the session record if needed. */
  private attach(
    sessionId: string,
    serverUuid: string,
    client: ConnectedClient,
  ): void {
    if (!this.activeSessions[sessionId]) {
      this.activeSessions[sessionId] = {};
      this.sessionToServers[sessionId] = new Set();
    }
    this.activeSessions[sessionId][serverUuid] = client;
    this.sessionToServers[sessionId].add(serverUuid);
    this.markUsed(sessionId, serverUuid);
  }

  /** Takes a connection away from a session, which keeps its other ones. */
  private detach(sessionId: string, serverUuid: string): void {
    delete this.activeSessions[sessionId]?.[serverUuid];
    this.sessionToServers[sessionId]?.delete(serverUuid);
    delete this.connectionLastUsed[sessionId]?.[serverUuid];
  }

  private forgetSession(sessionId: string): void {
    delete this.activeSessions[sessionId];
    delete this.sessionTimestamps[sessionId];
    delete this.sessionToServers[sessionId];
    delete this.connectionLastUsed[sessionId];
  }

  /**
   * Hands back a connection no session uses any more: parked as the
   * server's spare when there is none, closed otherwise.
   */
  private async release(
    serverUuid: string,
    client: ConnectedClient,
  ): Promise<"kept" | "recycled" | "destroyed"> {
    // Still shared with another session (per-server cap), or already parked
    if (
      this.isHeldBySession(client) ||
      this.idleSessions[serverUuid] === client
    ) {
      return "kept";
    }

    // A connection opened with a client's forwarded headers carries that
    // client's credentials: it never serves anybody else.
    const params = this.serverParamsCache[serverUuid];
    const carriesClientHeaders =
      params !== undefined && serverRequiresForwardedHeaders(params);

    if (!this.idleSessions[serverUuid] && !carriesClientHeaders) {
      this.setIdle(serverUuid, client);
      return "recycled";
    }

    try {
      await client.cleanup();
    } catch (error) {
      logger.error(
        `Error cleaning up extra connection for server ${serverUuid}:`,
        error,
      );
    }
    return "destroyed";
  }

  /**
   * At the per-server cap: takes the connection of the session that used
   * this server least recently and has no request in flight. That session
   * opens a new one on its next request.
   */
  private takeOverConnection(
    serverUuid: string,
    forSessionId: string,
  ): ConnectedClient | undefined {
    let victim: string | undefined;
    let oldest = Infinity;
    for (const [sessionId, sessionServers] of Object.entries(
      this.activeSessions,
    )) {
      if (
        sessionId === forSessionId ||
        !sessionServers[serverUuid] ||
        this.sessionRequests.has(sessionId)
      ) {
        continue;
      }
      const lastUsed = this.connectionLastUsed[sessionId]?.[serverUuid] ?? 0;
      if (lastUsed < oldest) {
        oldest = lastUsed;
        victim = sessionId;
      }
    }

    if (!victim) {
      return undefined;
    }
    const client = this.activeSessions[victim][serverUuid];
    this.detach(victim, serverUuid);
    logger.info(
      `Took over the connection of idle session ${victim} to server ${serverUuid} (per-server cap ${this.maxConnectionsPerServer})`,
    );
    return client;
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
    const existing = this.getActiveConnection(sessionId, serverUuid);
    if (existing) {
      return existing;
    }

    // Check if we have an idle session for this server that we can convert.
    // Skip idle reuse for servers with forward_headers since each client may
    // need unique credentials forwarded to the backend MCP server.
    if (!serverRequiresForwardedHeaders(params)) {
      const idleClient = this.takeIdle(serverUuid);
      if (idleClient) {
        this.attach(sessionId, serverUuid, idleClient);

        logger.info(
          `Converted idle session to active for server ${serverUuid}, session ${sessionId}`,
        );

        // Warm pool: start the replacement spare right away (non-blocking)
        if (this.warmPool) {
          this.createIdleSessionAsync(serverUuid, params, namespaceUuid);
        }

        return idleClient;
      }
    }

    // No idle session available — check per-server cap before spawning
    if (!this.canCreateConnectionForServer(serverUuid)) {
      // At cap: take the connection of a session that is not using it,
      // and only share one when every holder has a request in flight.
      const takenOver = this.takeOverConnection(serverUuid, sessionId);
      if (takenOver) {
        this.attach(sessionId, serverUuid, takenOver);
        return takenOver;
      }

      const reusable = this.findOldestActiveConnectionForServer(serverUuid);
      if (reusable) {
        logger.info(
          `Reusing existing connection for server ${serverUuid} (at per-server cap ${this.maxConnectionsPerServer})`,
        );
        this.attach(sessionId, serverUuid, reusable);
        return reusable;
      }
    }

    const newClient = await this.createNewConnection(params, namespaceUuid);
    if (!newClient) {
      return undefined;
    }

    // Re-check after the async gap: a concurrent getSession() call for the same
    // (sessionId, serverUuid) pair may have stored a connection while we were awaiting
    // createNewConnection(). If so, discard ours to avoid leaking the spawned process.
    const concurrent = this.getActiveConnection(sessionId, serverUuid);
    if (concurrent) {
      newClient.cleanup().catch((error) => {
        logger.error(
          `Error cleaning up duplicate connection for server ${params.uuid}:`,
          error,
        );
      });
      return concurrent;
    }

    this.attach(sessionId, serverUuid, newClient);

    logger.info(
      `Created new active session for server ${serverUuid}, session ${sessionId}`,
    );

    // Warm pool: keep a spare ready for the next client. Only for servers
    // that don't require forwarded headers: idle sessions are created without
    // per-client headers, so they can't be reused when per-client header
    // forwarding is configured.
    if (this.warmPool && !serverRequiresForwardedHeaders(params)) {
      this.createIdleSessionAsync(serverUuid, params, namespaceUuid);
    }

    return newClient;
  }

  /**
   * The connection `sessionId` holds to `serverUuid`, marked as used.
   * Undefined once idle reaping released it: getSession() opens a new one.
   */
  getActiveConnection(
    sessionId: string,
    serverUuid: string,
  ): ConnectedClient | undefined {
    const client = this.activeSessions[sessionId]?.[serverUuid];
    if (client) {
      // Touch on every access so idle timeouts count from the last use
      this.markUsed(sessionId, serverUuid);
    }
    return client;
  }

  /**
   * Runs a client request of `sessionId`. While it runs, idle reaping
   * leaves the session's connections alone, and the connections it used
   * count as used until it ends.
   */
  async trackRequest<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    this.sessionRequests.set(
      sessionId,
      (this.sessionRequests.get(sessionId) ?? 0) + 1,
    );
    try {
      return await run();
    } finally {
      const now = Date.now();
      if (this.activeSessions[sessionId]) {
        this.sessionTimestamps[sessionId] = now;
      }
      const used = this.connectionLastUsed[sessionId];
      if (used) {
        for (const [serverUuid, lastUsed] of Object.entries(used)) {
          if (lastUsed >= startedAt) {
            used[serverUuid] = now;
          }
        }
      }
      const open = (this.sessionRequests.get(sessionId) ?? 1) - 1;
      if (open > 0) {
        this.sessionRequests.set(sessionId, open);
      } else {
        this.sessionRequests.delete(sessionId);
      }
    }
  }

  /**
   * Create a new connection for a server
   */
  private async createNewConnection(
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<ConnectedClient | undefined> {
    // Check connection limit before attempting to create
    if (!this.canCreateConnection()) {
      logger.warn(
        `Skipping connection for server ${params.name} (${params.uuid}) - connection limit reached`,
      );
      return undefined;
    }

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
    const generation = this.idleSessionGenerations[serverUuid] ?? 0;

    try {
      const newClient = await this.createNewConnection(params, namespaceUuid);
      if (newClient) {
        const currentGeneration = this.idleSessionGenerations[serverUuid] ?? 0;
        if (
          !this.idleSessions[serverUuid] &&
          currentGeneration === generation
        ) {
          this.setIdle(serverUuid, newClient);
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
      if ((this.idleSessionGenerations[serverUuid] ?? 0) === generation) {
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
    const generation = this.idleSessionGenerations[serverUuid] ?? 0;

    // Create the session in the background (fire and forget)
    this.createNewConnection(params, namespaceUuid)
      .then((newClient) => {
        const currentGeneration = this.idleSessionGenerations[serverUuid] ?? 0;
        if (
          newClient &&
          !this.idleSessions[serverUuid] &&
          currentGeneration === generation
        ) {
          this.setIdle(serverUuid, newClient);
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
        if ((this.idleSessionGenerations[serverUuid] ?? 0) === generation) {
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
        // Idle sessions of servers with forwarded headers are never used
        if (
          !this.idleSessions[uuid] &&
          !serverRequiresForwardedHeaders(params)
        ) {
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
    if (!activeSession) {
      return;
    }

    // Detach the session before any await: a request racing this cleanup
    // opens new connections instead of picking up the ones released here.
    this.forgetSession(sessionId);

    let recycled = 0;
    let destroyed = 0;

    // Try to recycle each connection back to idle pool
    for (const [serverUuid, client] of Object.entries(activeSession)) {
      const outcome = await this.release(serverUuid, client);
      if (outcome === "recycled") {
        recycled++;
        logger.info(
          `Recycled active connection for server ${serverUuid} to idle pool (session ${sessionId})`,
        );
      } else if (outcome === "destroyed") {
        destroyed++;
      }
    }

    logger.info(
      `Cleaned up session ${sessionId} (recycled: ${recycled}, destroyed: ${destroyed})`,
    );
  }

  /**
   * Closes what nobody used for MCP_CONNECTION_IDLE_TTL: the connections of
   * client sessions that stopped calling a server (they open a new one on
   * their next request), then, without a warm pool, the spare connections
   * nobody took.
   */
  async reapIdleConnections(): Promise<void> {
    const ttl = this.connectionIdleTtlMs;
    if (ttl <= 0) {
      return;
    }

    try {
      const now = Date.now();
      const released: Array<[string, ConnectedClient]> = [];

      for (const [sessionId, sessionServers] of Object.entries(
        this.activeSessions,
      )) {
        // A request in flight may be using any connection of its session
        if (this.sessionRequests.has(sessionId)) {
          continue;
        }
        for (const [serverUuid, client] of Object.entries(sessionServers)) {
          const lastUsed =
            this.connectionLastUsed[sessionId]?.[serverUuid] ??
            this.sessionTimestamps[sessionId] ??
            0;
          if (now - lastUsed > ttl) {
            this.detach(sessionId, serverUuid);
            released.push([serverUuid, client]);
            logger.info(
              `Released the connection of session ${sessionId} to server ${serverUuid}: unused for ${Math.round((now - lastUsed) / 60_000)} min`,
            );
          }
        }
        if (Object.keys(sessionServers).length === 0) {
          this.forgetSession(sessionId);
        }
      }

      for (const [serverUuid, client] of released) {
        await this.release(serverUuid, client);
      }

      // A warm pool keeps its spares: that is its point
      if (this.warmPool) {
        return;
      }

      for (const [serverUuid, client] of Object.entries(this.idleSessions)) {
        const since = this.idleSince.get(client);
        if (since === undefined) {
          this.idleSince.set(client, now);
          continue;
        }
        if (now - since <= ttl) {
          continue;
        }
        this.takeIdle(serverUuid);
        try {
          await client.cleanup();
        } catch (error) {
          logger.error(
            `Error closing idle connection for server ${serverUuid}:`,
            error,
          );
        }
        logger.info(
          `Closed the idle connection of server ${serverUuid}: unused for ${Math.round((now - since) / 60_000)} min`,
        );
      }
    } catch (error) {
      logger.error("Error while closing idle MCP connections:", error);
    }
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
    this.connectionLastUsed = {};
    this.serverParamsCache = {};

    // Bump all known generations (never reset to {}) so any in-flight idle
    // creation that started before cleanupAll() resolves with a stale value
    // and discards itself. Cover both tracked entries and UUIDs that are only
    // in creatingIdleSessions (which default to 0 and have no map entry yet).
    for (const uuid of new Set([
      ...Object.keys(this.idleSessionGenerations),
      ...this.creatingIdleSessions,
    ])) {
      this.idleSessionGenerations[uuid] =
        (this.idleSessionGenerations[uuid] ?? 0) + 1;
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
    const active = Object.keys(this.activeSessions).reduce(
      (total, sessionId) =>
        total + Object.keys(this.activeSessions[sessionId]).length,
      0,
    );

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
    const idle = Object.keys(this.idleSessions).length;
    // Distinct clients: sessions may share one at the per-server cap
    const active = new Set(
      Object.values(this.activeSessions).flatMap((sessionServers) =>
        Object.values(sessionServers),
      ),
    ).size;
    const pending = this.creatingIdleSessions.size;
    return idle + active + pending;
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
    // Collect every doomed ConnectedClient across all active sessions plus
    // the idle slot, dropping the map entries as we go.
    const cleanupPromises: Promise<void>[] = [];

    for (const [sid, sessionServers] of Object.entries(this.activeSessions)) {
      const cachedClient = sessionServers[serverUuid];
      if (!cachedClient) {
        continue;
      }
      // Each cleanup is wrapped so one failure can't strand the rest — we
      // WANT every stale slot dropped from the map regardless.
      cleanupPromises.push(
        (async () => {
          try {
            await cachedClient.cleanup();
          } catch (error) {
            logger.error(
              `Error cleaning up invalidated active session ${sid}/${serverUuid}:`,
              error,
            );
          }
        })(),
      );
      delete sessionServers[serverUuid];
      this.sessionToServers[sid]?.delete(serverUuid);
    }

    const idleClient = this.idleSessions[serverUuid];
    if (idleClient) {
      cleanupPromises.push(
        (async () => {
          try {
            await idleClient.cleanup();
          } catch (error) {
            logger.error(
              `Error cleaning up invalidated idle session for ${serverUuid}:`,
              error,
            );
          }
        })(),
      );
      delete this.idleSessions[serverUuid];
    }

    // Drop the in-flight idle-creation guard so the recovery's getSession
    // call isn't blocked from spawning a fresh connection.
    this.creatingIdleSessions.delete(serverUuid);

    await Promise.all(cleanupPromises);

    if (cleanupPromises.length > 0) {
      logger.warn(
        `Invalidated ${cleanupPromises.length} pooled backend connection(s) for server ${serverUuid} ` +
          `(triggered by session ${sessionId}; cascaded across every active + idle slot for this serverUuid)`,
      );
    } else {
      logger.warn(
        `Invalidated pooled backend connection for server ${serverUuid} (session ${sessionId}) — no clients were cached`,
      );
    }
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
    logger.info(`Invalidating idle session for server ${serverUuid}`);

    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Cleanup existing idle session if it exists. Taken out of the slot
    // first, so that no client picks it up while it closes.
    const existingIdleSession = this.takeIdle(serverUuid);
    if (existingIdleSession) {
      try {
        await existingIdleSession.cleanup();
        logger.info(
          `Cleaned up existing idle session for server ${serverUuid}`,
        );
      } catch (error) {
        logger.error(
          `Error cleaning up existing idle session for server ${serverUuid}:`,
          error,
        );
      }
    }

    // Bump the generation before clearing the in-progress guard so any
    // in-flight createIdleSession / createIdleSessionAsync that resolves
    // after this point will see a stale generation and discard its result.
    this.idleSessionGenerations[serverUuid] =
      (this.idleSessionGenerations[serverUuid] ?? 0) + 1;
    this.creatingIdleSessions.delete(serverUuid);

    // Warm pool: create a new idle session with updated parameters.
    // Otherwise the next client opens one with them.
    if (this.warmPool) {
      await this.createIdleSession(serverUuid, params, namespaceUuid);
    }
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
    logger.info(`Cleaning up idle session for server ${serverUuid}`);

    // Cleanup existing idle session if it exists
    const existingIdleSession = this.takeIdle(serverUuid);
    if (existingIdleSession) {
      try {
        await existingIdleSession.cleanup();
        logger.info(`Cleaned up idle session for server ${serverUuid}`);
      } catch (error) {
        logger.error(
          `Error cleaning up idle session for server ${serverUuid}:`,
          error,
        );
      }
    }

    // Bump rather than delete the generation entry. Deleting would reset the
    // effective value to 0 (via the ?? 0 default), which could spuriously match
    // an in-flight creation that also captured 0 before this cleanup ran,
    // allowing a stale subprocess to repopulate idleSessions after the server
    // was removed.
    this.idleSessionGenerations[serverUuid] =
      (this.idleSessionGenerations[serverUuid] ?? 0) + 1;
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
    // Update server params cache
    this.serverParamsCache[serverUuid] = params;

    // Without a warm pool the first client opens the connection
    if (!this.warmPool) {
      return;
    }

    logger.info(`Ensuring idle session exists for new server ${serverUuid}`);

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
    // Bump generation and release the guard FIRST — before any await — so that
    // an in-flight idle creation that resolves during the cleanup loop below
    // (e.g. while we await an active-session cleanup) sees a stale generation
    // and discards its result instead of storing it into the now-empty slot.
    this.idleSessionGenerations[serverUuid] =
      (this.idleSessionGenerations[serverUuid] ?? 0) + 1;
    this.creatingIdleSessions.delete(serverUuid);

    // Clean up idle session
    const idleSession = this.idleSessions[serverUuid];
    if (idleSession) {
      try {
        await idleSession.cleanup();
        logger.info(`Cleaned up idle session for crashed server ${serverUuid}`);
      } catch (error) {
        logger.error(
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
          logger.info(
            `Cleaned up active session ${sessionId} for crashed server ${serverUuid}`,
          );
        } catch (error) {
          logger.error(
            `Error cleaning up active session ${sessionId} for crashed server ${serverUuid}:`,
            error,
          );
        }
        delete sessionServers[serverUuid];
        this.sessionToServers[sessionId]?.delete(serverUuid);
      }
    }
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
    this.cleanupTimer.unref();
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

      // Find expired sessions (never while a request is in flight)
      for (const [sessionId, timestamp] of Object.entries(
        this.sessionTimestamps,
      )) {
        if (
          now - timestamp > sessionLifetime &&
          !this.sessionRequests.has(sessionId)
        ) {
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
    // Every 60 seconds: close unused connections, then check the idle ones
    this.healthCheckTimer = setInterval(async () => {
      await this.reapIdleConnections();
      await this.checkIdleSessionHealth();
    }, 60 * 1000); // 60 seconds
    this.healthCheckTimer.unref();
  }

  /**
   * Check health of idle sessions by pinging them.
   * Dead sessions are cleaned up (and recreated by a warm pool).
   * Warm pool: servers in ERROR state whose crash counters have been reset
   * are retried.
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
        // A client took it during the ping: its requests recover by themselves
        if (this.idleSessions[serverUuid] !== client) {
          continue;
        }

        logger.warn(
          `Idle session health check failed for server ${serverUuid}, ${this.warmPool ? "recreating" : "closing"}...`,
        );

        // Clean up the dead session
        this.takeIdle(serverUuid);
        try {
          await client.cleanup();
        } catch {
          // Already dead, ignore cleanup errors
        }

        // Without a warm pool the next client opens a new connection
        if (!this.warmPool) {
          continue;
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

    if (!this.warmPool) {
      return;
    }

    // Also check for servers in ERROR state that have cached params but no idle session.
    // If they were reset (e.g., on startup), we should try to recreate them.
    // Not for servers with forwarded headers: their idle sessions are never used.
    for (const [serverUuid, params] of Object.entries(this.serverParamsCache)) {
      if (
        !this.idleSessions[serverUuid] &&
        !this.creatingIdleSessions.has(serverUuid) &&
        !serverRequiresForwardedHeaders(params)
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
