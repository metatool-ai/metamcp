import { ServerParameters } from "@repo/zod-types";
import { ListToolsResultSchema, Tool } from "@modelcontextprotocol/sdk/types.js";

import logger from "@/utils/logger";

import { toolsRepository } from "../../db/repositories";
import { configService } from "../config.service";
import { getMcpServers } from "./fetch-metamcp";
import { filterOutOverrideTools } from "./override-filter";
import { toolsSyncCache } from "./tools-sync-cache";

/**
 * Background tools-sync loop + freshness tracker.
 *
 * Keeps the `tools` table fresh so `tools/list` can be served from the DB (the
 * fast hot path) instead of fanning out to every backend. The loop runs off the
 * request path entirely; a request that finds a stale/absent server calls
 * `ensureFresh()` (debounced) to pull it in soon, but returns immediately from
 * cached DB rows.
 *
 * Freshness model (per server):
 *  - lastSyncedAt tracked in-memory.
 *  - TTL default 60s (`MCP_TOOLS_TTL_MS`).
 *  - "stale"  = now - lastSyncedAt > TTL   → serve last-known from DB + refresh in bg.
 *  - "absent" = no tools rows for the server → one-off bounded fetch (fallback) in the
 *               request path.
 */

const DEFAULT_TTL_MS = 60_000;

class BackgroundToolsSync {
  private loopTimer: NodeJS.Timeout | null = null;
  private readonly syncIntervalMs: number;
  private readonly ttlMs: number;
  private readonly lastSyncedAt: Map<string, number> = new Map();
  private readonly inFlight: Set<string> = new Set();

  constructor(syncIntervalMs: number = 60_000) {
    this.syncIntervalMs = syncIntervalMs;
    this.ttlMs = parseInt(process.env.MCP_TOOLS_TTL_MS || `${DEFAULT_TTL_MS}`, 10);
  }

  /** Start the periodic loop (idempotent). */
  start(): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      this.loop().catch((error) => {
        logger.error("[tools-sync] background loop error:", error);
      });
    }, this.syncIntervalMs);
    // Unref so the loop doesn't keep the process alive on its own.
    this.loopTimer.unref();
  }

  /** Stop the periodic loop. */
  stop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /** True if the server's cached tools are still fresh. */
  isFresh(serverUuid: string): boolean {
    const last = this.lastSyncedAt.get(serverUuid);
    if (last === undefined) return false;
    return Date.now() - last < this.ttlMs;
  }

  /**
   * Debounced single-server refresh. Called from the request path when a server
   * is stale/absent. Non-blocking; returns immediately.
   */
  ensureFresh(serverUuid: string, params: ServerParameters, namespaceUuid: string): void {
    if (this.inFlight.has(serverUuid)) return;
    this.syncServer(serverUuid, params, namespaceUuid).catch((error) => {
      logger.error(`[tools-sync] background refresh failed for ${serverUuid}:`, error);
    });
  }

  /** One full pass over every namespace + ACTIVE server, syncing stale ones. */
  private async loop(): Promise<void> {
    const namespaces = await this.getAllNamespaces();
    for (const ns of namespaces) {
      try {
        const serverParams = await getMcpServers(ns, false);
        const entries = Object.entries(serverParams);
        logger.info(
          `[tools-sync] pass: namespace ${ns} has ${entries.length} active servers`,
        );
        await Promise.allSettled(
          entries.map(async ([uuid, params]) => {
            if (this.isFresh(uuid)) return;
            await this.syncServer(uuid, params, ns);
          }),
        );
      } catch (error) {
        logger.error(`[tools-sync] pass failed for namespace ${ns}:`, error);
      }
    }
  }

  /**
   * Fetch + filter + sync ONE server's tools into the DB. Used by both the loop
   * and the on-demand `ensureFresh`. Bounded by the configurable MCP timeout so a
   * hung backend can't stall the loop.
   */
  private async syncServer(
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid: string,
  ): Promise<void> {
    if (this.inFlight.has(serverUuid)) return;
    this.inFlight.add(serverUuid);
    try {
      const timeout = await configService.getMcpTimeout();
      const tools = await this.fetchToolsForServer(params, timeout);
      const toolNames = tools.map((t) => t.name);
      const hasChanged = toolsSyncCache.hasChanged(serverUuid, toolNames);
      if (hasChanged) {
        const toolsToSave = await filterOutOverrideTools(
          tools,
          namespaceUuid,
          params.name,
        );
        if (toolsToSave.length > 0) {
          toolsSyncCache.update(serverUuid, toolNames);
          await toolsRepository.syncTools({
            tools: toolsToSave,
            mcpServerUuid: serverUuid,
          });
          logger.info(
            `[tools-sync] synced ${toolsToSave.length} tools for ${params.name} (${serverUuid})`,
          );
        }
      }
      this.lastSyncedAt.set(serverUuid, Date.now());
    } finally {
      this.inFlight.delete(serverUuid);
    }
  }

  /** Bounded tools/list fetch against a single backend server. */
  private async fetchToolsForServer(
    params: ServerParameters,
    timeout: number,
  ): Promise<Tool[]> {
    // Prefer a warm pooled connection (the pool holds idle sessions); fall back
    // to a bounded one-off connect only if the pool has none available.
    const { mcpServerPool } = await import("./mcp-server-pool");
    const session = await mcpServerPool.getSession(
      `tools-sync-${params.uuid}`,
      params.uuid,
      params,
    );

    if (session) {
      try {
        const result = await session.client.request(
          { method: "tools/list", params: {} },
          ListToolsResultSchema,
          { timeout, resetTimeoutOnProgress: true },
        );
        return result.tools || [];
      } finally {
        // Return the connection to the pool (recycles back to idle).
        await mcpServerPool.cleanupSession(`tools-sync-${params.uuid}`);
      }
    }

    // Pool refused (at cap / error state) — one-off bounded connect.
    const { connectMetaMcpClient } = await import("./client");
    const connected = await connectMetaMcpClient(params);
    if (!connected) return [];
    try {
      const result = await connected.client.request(
        { method: "tools/list", params: {} },
        ListToolsResultSchema,
        { timeout, resetTimeoutOnProgress: true },
      );
      return result.tools || [];
    } finally {
      await connected.cleanup();
    }
  }

  /** All namespace UUIDs from the DB. */
  private async getAllNamespaces(): Promise<string[]> {
    const { namespacesRepository } = await import("../../db/repositories");
    const namespaces = await namespacesRepository.findAll();
    return namespaces.map((n) => n.uuid);
  }
}

export const backgroundToolsSync = new BackgroundToolsSync();
export type { ServerParameters };
