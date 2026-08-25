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
  lastEvictedAt?: number | null;
  evictionCount?: number;
}

export interface McpServerPoolDebugInfo {
  idle: number;
  active: number;
  pending: number;
  evicted: number;
  lastEvictedAt: number | null;
  total: number;
  maxTotalConnections: number;
  maxConnectionsPerServer: number;
  spawnConcurrency: number;
  idleTimeoutMs: number;
  sessionLifetimeMs: number | null;
  activeSessionIds: string[];
  idleServerUuids: string[];
  perServerCounts: Record<string, number>;
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

  // Default number of idle sessions per server UUID
  private readonly defaultIdleCount: number;

  // Maximum total connections (idle + active) to prevent runaway process spawning
  private readonly maxTotalConnections: number;

  // Maximum connections per individual server UUID (prevents per-server process explosion)
  private readonly maxConnectionsPerServer: number;

  // Connection eviction accounting (drives the diagnostics log + status).
  private lastEvictedAt: number | null = null;
  private evictionCount = 0;

  // Per-server idle timeout (ms). Idle sessions idle for longer than this are
  // cleaned up by checkIdleSessionHealth (the 60s health loop), preventing a
  // parked session from holding a process forever.
  private readonly idleTimeoutMs: number;

  // Spawn concurrency gate for cold-start: cap how many cold server processes
  // may be connecting at once. Without it ensureIdleSessions() fires ~22
  // simultaneous spawns that blow past the SDK connect timeout (the
  // -32001/-32000 storm). Bounded spawns let each process get a fair share of
  // CPU while it boots.
  private spawnConcurrency = 0;
  private readonly maxSpawnConcurrency: number;

  private constructor(
    defaultIdleCount: number = 1,
    maxTotalConnections: number = parseInt(
      process.env.MAX_TOTAL_CONNECTIONS || "100",
      10,
    ),
    maxConnectionsPerServer: number = parseInt(
      process.env.MAX_CONNECTIONS_PER_SERVER || "5",
      10,
    ),
  ) {
    this.defaultIdleCount = defaultIdleCount;
    this.maxTotalConnections = maxTotalConnections;
    this.maxConnectionsPerServer = maxConnectionsPerServer;
    this.idleTimeoutMs = parseInt(
      process.env.MCP_IDLE_TIMEOUT_MS || `${30 * 60 * 1000}`,
      10,
    );
    this.maxSpawnConcurrency = parseInt(
      process.env.MCP_SPAWN_CONCURRENCY || "4",
      10,
    );
    this.startCleanupTimer();
    this.startHealthCheckTimer();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(
    defaultIdleCount: number = 1,
    maxConnectionsPerServer: number = parseInt(
      process.env.MAX_CONNECTIONS_PER_SERVER || "5",
      10,
    ),
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
    let count = 0;

    // Count idle session
    if (this.idleSessions[serverUuid]) {
      count += 1;
    }

    // Count active sessions across all sessionIds
    for (const sessionServers of Object.values(this.activeSessions)) {
      if (sessionServers[serverUuid]) {
        count += 1;
      }
    }

    // Count pending idle creation
    if (this.creatingIdleSessions.has(serverUuid)) {
      count += 1;
    }

    return count;
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
   * Record a connection eviction for the diagnostics log / status.
   */
  private recordEviction(): void {
    this.lastEvictedAt = Date.now();
    this.evictionCount += 1;
  }

  /**
   * Find the idle session with the oldest last-touch timestamp. Only returns
   * one that actually predates `before` — a freshly-created idle session is
   * not a valid eviction victim.
   */
  private findIdleEvictionVictim(before: number): ConnectedClient | undefined {
    let victim: ConnectedClient | undefined;
    let oldest: number | null = null;

    for (const client of Object.values(this.idleSessions)) {
      if (!client.lastUsedAt || client.lastUsedAt >= before) {
        continue;
      }
      if (oldest === null || client.lastUsedAt < oldest) {
        oldest = client.lastUsedAt;
        victim = client;
      }
    }
    return victim;
  }

  /**
   * Evict an idle connection for a server UUID, freeing one connection slot.
   *
   * Idle sessions are capped at ONE per server UUID (see getSession idle
   * reuse + cleanupSession recycling), so a per-server eviction must be able
   * to drop a *different* server's idle session. Called with the timestamp
   * captured when the eviction decision was made so a concurrently-created
   * idle session (which has no lastUsedAt yet) is never picked as a victim.
   */
  private async evictOldestIdle(before: number): Promise<boolean> {
    const victim = this.findIdleEvictionVictim(before);
    if (!victim) {
      return false;
    }

    // Remove from the idle map regardless of cleanup success.
    for (const [serverUuid, client] of Object.entries(this.idleSessions)) {
      if (client === victim) {
        delete this.idleSessions[serverUuid];
        break;
      }
    }
    this.recordEviction();
    logger.warn(
      `Evicted oldest idle MCP connection (concurrency slot exhausted; connection count ${this.getTotalConnectionCount()}/${this.maxTotalConnections})`,
    );

    try {
      await victim.cleanup();
    } catch (error) {
      logger.error("Error cleaning up evicted idle connection:", error);
    }
    return true;
  }

  /**
   * Evict the LRU active connection for a server UUID (the session slot with
   * the oldest last-touch), freeing one connection slot so a mid-flight
   * server gets one. The evicted server's remaining active slots are removed
   * from the request session; a subsequent getSession for that server
   * re-establishes a connection on demand.
   */
  private async evictOldestActiveConnectionForServer(
    serverUuid: string,
  ): Promise<boolean> {
    let oldestSessionId: string | undefined;
    let oldestTimestamp = Infinity;

    for (const [sessionId, sessionServers] of Object.entries(
      this.activeSessions,
    )) {
      const cached = sessionServers[serverUuid];
      if (!cached) {
        continue;
      }
      const timestamp =
        cached.lastUsedAt || this.sessionTimestamps[sessionId] || 0;
      if (timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
        oldestSessionId = sessionId;
      }
    }

    if (!oldestSessionId) {
      return false;
    }

    const victim = this.activeSessions[oldestSessionId]?.[serverUuid];
    if (!victim) {
      return false;
    }
    delete this.activeSessions[oldestSessionId][serverUuid];
    this.sessionToServers[oldestSessionId]?.delete(serverUuid);

    // Clean up empty session slots so they stop counting toward the active
    // total (the leak) and get dropped from the session map.
    if (Object.keys(this.activeSessions[oldestSessionId]).length === 0) {
      delete this.activeSessions[oldestSessionId];
      delete this.sessionToServers[oldestSessionId];
      delete this.sessionTimestamps[oldestSessionId];
    }

    this.recordEviction();
    logger.warn(
      `Evicted LRU active MCP connection for server ${serverUuid} (session ${oldestSessionId}); slot freed for a mid-flight server`,
    );

    try {
      await victim.cleanup();
    } catch (error) {
      logger.error(
        `Error cleaning up evicted active connection for ${serverUuid}:`,
        error,
      );
    }
    return true;
  }

  /**
   * Acquire a spawn-concurrency slot. Bounds how many cold server processes
   * may be connecting at once so a cold start doesn't blow past the SDK
   * connect timeout with ~22 simultaneous spawns.
   */
  private acquireSpawnSlot(before: number): Promise<() => void> {
    return new Promise((resolve) => {
      const attempt = (): void => {
        if (this.spawnConcurrency < this.maxSpawnConcurrency) {
          this.spawnConcurrency += 1;
          resolve(() => {
            this.spawnConcurrency -= 1;
          });
          return;
        }
        // Slot full. If the pool is at the hard cap, evict the oldest idle
        // connection to make room for the cold start (a cold start must not
        // be able to strand the pool at the cap forever). Either way, defer
        // the retry through setTimeout so the event loop stays responsive —
        // a synchronous .then(attempt) recursion would starve macrotasks
        // (timers/I/O) and prevent in-flight connects from releasing their
        // slots.
        if (this.getTotalConnectionCount() >= this.maxTotalConnections) {
          this.evictOldestIdle(before).then((evicted) => {
            setTimeout(attempt, evicted ? 0 : 250);
          });
          return;
        }
        setTimeout(attempt, 250);
      };
      attempt();
    });
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
      const cached = this.activeSessions[sessionId][serverUuid];
      // Touch lastUsedAt on every access so SESSION_LIFETIME acts as idle
      // timeout (not a hard TTL) and the LRU eviction sees recent activity.
      cached.lastUsedAt = Date.now();
      this.sessionTimestamps[sessionId] = Date.now();
      return cached;
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
        this.activeSessions[sessionId][serverUuid] = idleClient;
        this.sessionToServers[sessionId].add(serverUuid);
        idleClient.lastUsedAt = Date.now();

        logger.info(
          `Converted idle session to active for server ${serverUuid}, session ${sessionId}`,
        );

        // Create a new idle session to replace the one we just used (ASYNC - NON-BLOCKING)
        this.createIdleSessionAsync(serverUuid, params, namespaceUuid);

        return idleClient;
      }
    }

    // No idle session available — check per-server cap before spawning. If at
    // the cap, try to reuse the oldest active connection for this server; if
    // none is reusable, evict its LRU active slot to make room (a mid-flight
    // server must always be able to obtain a slot rather than be refused).
    if (!this.canCreateConnectionForServer(serverUuid)) {
      const reusable = this.findOldestActiveConnectionForServer(serverUuid);
      if (reusable) {
        logger.info(
          `Reusing existing connection for server ${serverUuid} (at per-server cap ${this.maxConnectionsPerServer})`,
        );
        this.activeSessions[sessionId][serverUuid] = reusable;
        this.sessionToServers[sessionId].add(serverUuid);
        reusable.lastUsedAt = Date.now();
        return reusable;
      }
      // Not reusable — free a slot by evicting this server's LRU active
      // connection, then fall through to spawn a fresh one.
      await this.evictOldestActiveConnectionForServer(serverUuid);
      // Re-evaluate per-server count after eviction (it may have made room,
      // and the count must be re-checked before we spawn).
      if (!this.canCreateConnectionForServer(serverUuid)) {
        logger.error(
          `Per-server cap still exceeded for ${serverUuid} after LRU eviction; refusing to spawn`,
        );
        return undefined;
      }
    }

    const newClient = await this.createNewConnection(params, namespaceUuid);
    if (!newClient) {
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

    // Guard a race with cleanupSession(): the session's map entry may have
    // been deleted while we were awaiting the connect. Store into a fresh
    // entry rather than a deleted object (which would throw and strand the
    // new process).
    if (!this.activeSessions[sessionId]) {
      this.activeSessions[sessionId] = {};
      this.sessionToServers[sessionId] = new Set();
      this.sessionTimestamps[sessionId] = Date.now();
    }
    this.activeSessions[sessionId][serverUuid] = newClient;
    this.sessionToServers[sessionId].add(serverUuid);
    newClient.lastUsedAt = Date.now();

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
    // Check connection limit before attempting to create
    if (!this.canCreateConnection()) {
      logger.warn(
        `Skipping connection for server ${params.name} (${params.uuid}) - connection limit reached`,
      );
      return undefined;
    }

    // Bound spawn concurrency. A cold start can queue many servers behind
    // this gate instead of firing ~22 simultaneous spawns that each blow
    // past the SDK connect timeout.
    const before = Date.now();
    const release = await this.acquireSpawnSlot(before);

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

      // Initialize the LRU touch used by idle/LRU eviction and the per-server
      // idle timeout. Created connections count as freshly-used.
      connectedClient.lastUsedAt = Date.now();

      return connectedClient;
    } finally {
      release();
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
    const generation = this.idleSessionGenerations[serverUuid] ?? 0;

    try {
      const newClient = await this.createNewConnection(params, namespaceUuid);
      if (newClient) {
        const currentGeneration = this.idleSessionGenerations[serverUuid] ?? 0;
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
        if ((this.idleSessionGenerations[serverUuid] ?? 0) === generation) {
          this.creatingIdleSessions.delete(serverUuid);
        }
      });
  }

  /**
   * Ensure idle sessions exist for all servers.
   *
   * Prewarms sequentially (each spawn still passes through the bounded
   * spawn-concurrency gate in createNewConnection). The old implementation
   * fired Promise.allSettled over every server at once, so a cold start
   * spawned ~22 simultaneous processes and blew past the SDK connect
   * timeout (-32001 / -32000). Sequential prewarm trades wall time for
   * connect success; the lazy on-first-use path in getSession covers the
   * gap until warm.
   */
  async ensureIdleSessions(
    serverParams: Record<string, ServerParameters>,
    namespaceUuid?: string,
  ): Promise<void> {
    for (const [uuid, params] of Object.entries(serverParams)) {
      if (!this.idleSessions[uuid]) {
        try {
          await this.createIdleSession(uuid, params, namespaceUuid);
        } catch (error) {
          // One bad server must not stall the rest of the prewarm.
          logger.error(
            `Error prewarming idle session for server ${uuid}:`,
            error,
          );
        }
      }
    }
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

    let recycled = 0;
    let destroyed = 0;

    // Try to recycle each connection back to idle pool. The idle pool is
    // capped at ONE healthy session per server UUID, so a second connection
    // for the same server is destroyed rather than stacked (the old behavior
    // let recycling + backfill grow the active map unboundedly — the leak).
    for (const [serverUuid, client] of Object.entries(activeSession)) {
      if (!this.idleSessions[serverUuid]) {
        // No idle session for this server — recycle the connection
        this.idleSessions[serverUuid] = client;
        // Touch so the LRU idle eviction sees it as freshly-used, and the
        // per-server idle timeout starts counting from the recycle moment.
        client.lastUsedAt = Date.now();
        recycled++;
        logger.info(
          `Recycled active connection for server ${serverUuid} to idle pool (session ${sessionId})`,
        );
      } else {
        // Already have an idle session — destroy the extra
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

    // Remove from active sessions
    delete this.activeSessions[sessionId];

    // Clean up session timestamp
    delete this.sessionTimestamps[sessionId];

    // Clean up session to servers mapping
    delete this.sessionToServers[sessionId];

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
      lastEvictedAt: this.lastEvictedAt,
      evictionCount: this.evictionCount,
    };
  }

  /**
   * Get total connection count (idle + active + pending)
   */
  private getTotalConnectionCount(): number {
    const idle = Object.keys(this.idleSessions).length;
    const active = Object.keys(this.activeSessions).reduce(
      (total, sessionId) =>
        total + Object.keys(this.activeSessions[sessionId]).length,
      0,
    );
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
   * Structured diagnostics for the pool (health endpoints / debug UI).
   * Exposes the idle/active/pending/evicted accounting the health loop logs.
   */
  async getDebugInfo(): Promise<McpServerPoolDebugInfo> {
    const idle = Object.keys(this.idleSessions).length;
    const active = Object.keys(this.activeSessions).reduce(
      (total, sessionId) =>
        total + Object.keys(this.activeSessions[sessionId]).length,
      0,
    );
    const pending = this.creatingIdleSessions.size;

    let sessionLifetimeMs: number | null;
    try {
      sessionLifetimeMs = await configService.getSessionLifetime();
    } catch {
      sessionLifetimeMs = null;
    }

    const perServerCounts: Record<string, number> = {};
    for (const serverUuid of Object.keys(this.serverParamsCache)) {
      perServerCounts[serverUuid] = this.countConnectionsForServer(serverUuid);
    }

    return {
      idle,
      active,
      pending,
      evicted: this.evictionCount,
      lastEvictedAt: this.lastEvictedAt,
      total: idle + active + pending,
      maxTotalConnections: this.maxTotalConnections,
      maxConnectionsPerServer: this.maxConnectionsPerServer,
      spawnConcurrency: this.maxSpawnConcurrency,
      idleTimeoutMs: this.idleTimeoutMs,
      sessionLifetimeMs,
      activeSessionIds: Object.keys(this.activeSessions),
      idleServerUuids: Object.keys(this.idleSessions),
      perServerCounts,
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

    // Cleanup existing idle session if it exists
    const existingIdleSession = this.idleSessions[serverUuid];
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
      delete this.idleSessions[serverUuid];
    }

    // Bump the generation before clearing the in-progress guard so any
    // in-flight createIdleSession / createIdleSessionAsync that resolves
    // after this point will see a stale generation and discard its result.
    this.idleSessionGenerations[serverUuid] =
      (this.idleSessionGenerations[serverUuid] ?? 0) + 1;
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
    logger.info(`Cleaning up idle session for server ${serverUuid}`);

    // Cleanup existing idle session if it exists
    const existingIdleSession = this.idleSessions[serverUuid];
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
      delete this.idleSessions[serverUuid];
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
        // Per-server idle timeout: a parked idle session must not hold a
        // process forever. Recycle if untouched past idleTimeoutMs.
        if (
          client.lastUsedAt &&
          Date.now() - client.lastUsedAt > this.idleTimeoutMs
        ) {
          logger.info(
            `Idle session for server ${serverUuid} idle past ${this.idleTimeoutMs}ms, recycling...`,
          );
          await client.cleanup();
          delete this.idleSessions[serverUuid];
          // Recreate so the slot stays warm for the next tools/list.
          const params = this.serverParamsCache[serverUuid];
          if (params) {
            this.createIdleSessionAsync(serverUuid, params);
          }
          continue;
        }

        // Ping with a 5-second timeout
        await client.client.ping({ timeout: 5000 });
      } catch {
        logger.warn(
          `Idle session health check failed for server ${serverUuid}, recreating...`,
        );

        // Clean up the dead session
        try {
          await client.cleanup();
        } catch {
          // Already dead, ignore cleanup errors
        }
        delete this.idleSessions[serverUuid];

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

    // Diagnostics: periodic pool accounting so the leak/storm footprint is
    // visible in the logs without needing a health probe.
    const active = Object.keys(this.activeSessions).reduce(
      (total, sessionId) =>
        total + Object.keys(this.activeSessions[sessionId]).length,
      0,
    );
    const idle = Object.keys(this.idleSessions).length;
    const pending = this.creatingIdleSessions.size;
    logger.info(
      `MCP pool diagnostics: idle=${idle} active(${Object.keys(this.activeSessions).length})=${active} pending=${pending} evicted=${this.evictionCount} lastEvictedAt=${this.lastEvictedAt ?? "never"} total=${idle + active + pending}/${this.maxTotalConnections}`,
    );
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
