import {
  type Implementation,
  type ListToolsResult,
  ListToolsResultSchema,
  type ServerCapabilities,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import {
  type McpServerSnapshotInsert,
  type McpServerSnapshotRow,
  mcpServerSnapshotsRepository,
} from "../../db/repositories/mcp-server-snapshots.repo";
import { nonNegativeIntFromEnv } from "../session-lifetime-manager";
import type { ConnectedClient } from "./client";
import { serverRequiresForwardedHeaders } from "./header-forwarding";

/**
 * tools/list starts every server of a namespace to read its tools, and so do
 * prompts/list and resources/list, which clients call as soon as they
 * connect. MetaMCP keeps what each server exposed the last time it was
 * listed; during MCP_TOOLS_CACHE_TTL it answers from that snapshot instead
 * of starting the server, which then only starts for a call.
 */

export interface ServerSnapshot {
  serverInfo?: Implementation;
  capabilities: ServerCapabilities;
  tools: Tool[];
  listedAt: Date;
}

export interface SnapshotStore {
  findListedSince(
    serverUuids: string[],
    listedSince: Date,
  ): Promise<McpServerSnapshotRow[]>;
  upsert(snapshot: McpServerSnapshotInsert): Promise<void>;
  deleteByServerUuid(serverUuid: string): Promise<void>;
}

/** Upper bound on the pages read from one tools/list. */
const MAX_PAGES = 100;

/** Every page of the tools of a connected server. */
export async function listAllTools(client: ConnectedClient): Promise<Tool[]> {
  const tools: Tool[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result: ListToolsResult = await client.client.request(
      { method: "tools/list", params: cursor ? { cursor } : {} },
      ListToolsResultSchema,
    );
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
    // A server repeating its cursor would loop forever
    if (cursor && seenCursors.has(cursor)) break;
    if (cursor) seenCursors.add(cursor);
  } while (cursor && seenCursors.size < MAX_PAGES);
  return tools;
}

export class ServerSnapshots {
  // When the snapshot of each server was last known to be listed
  private readonly listedAt = new Map<string, number>();

  constructor(
    private readonly store: SnapshotStore,
    private readonly ttlMs: number,
    // Servers in use get their snapshot refreshed once in this interval
    private readonly refreshAfterMs: number = 60 * 60 * 1000,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  /**
   * Whether a server may be answered from its snapshot: not when it forwards
   * client headers, as its answer may then depend on the client.
   */
  canUse(params: ServerParameters): boolean {
    return this.enabled && !serverRequiresForwardedHeaders(params);
  }

  /** The snapshots of these servers listed within the TTL. */
  async fresh(serverUuids: string[]): Promise<Map<string, ServerSnapshot>> {
    const snapshots = new Map<string, ServerSnapshot>();
    if (!this.enabled || serverUuids.length === 0) {
      return snapshots;
    }
    try {
      const rows = await this.store.findListedSince(
        serverUuids,
        new Date(Date.now() - this.ttlMs),
      );
      for (const row of rows) {
        snapshots.set(row.mcp_server_uuid, {
          serverInfo: row.server_info ?? undefined,
          capabilities: row.capabilities,
          tools: row.tools,
          listedAt: row.listed_at,
        });
        this.listedAt.set(row.mcp_server_uuid, row.listed_at.getTime());
      }
    } catch (error) {
      logger.error("Error reading MCP server snapshots:", error);
    }
    return snapshots;
  }

  /** Records the tools a server listed on a live connection. */
  async record(
    params: ServerParameters,
    client: ConnectedClient,
    tools: Tool[],
  ): Promise<void> {
    if (!this.canUse(params)) {
      return;
    }
    try {
      await this.store.upsert({
        mcp_server_uuid: params.uuid,
        server_info: client.client.getServerVersion() ?? null,
        capabilities: client.client.getServerCapabilities() ?? {},
        tools,
      });
      this.listedAt.set(params.uuid, Date.now());
    } catch (error) {
      logger.error(
        `Error recording the snapshot of MCP server ${params.name} (${params.uuid}):`,
        error,
      );
    }
  }

  /**
   * A connection was opened to `params` for a call: list its tools in the
   * background when its snapshot is getting old, so that the servers in use
   * never need to be started just to be listed.
   */
  refreshInBackground(params: ServerParameters, client: ConnectedClient): void {
    if (!this.canUse(params) || !client.client.getServerCapabilities()?.tools) {
      return;
    }
    const listedAt = this.listedAt.get(params.uuid) ?? 0;
    if (Date.now() - listedAt < this.refreshAfterMs) {
      return;
    }
    // Only one refresh at a time per server
    this.listedAt.set(params.uuid, Date.now());
    listAllTools(client)
      .then((tools) => this.record(params, client, tools))
      .catch((error) => {
        this.listedAt.set(params.uuid, listedAt);
        logger.warn(
          `Could not refresh the snapshot of MCP server ${params.name} (${params.uuid}):`,
          error,
        );
      });
  }

  /** Drops the snapshot of a server whose configuration changed. */
  async forget(serverUuid: string): Promise<void> {
    this.listedAt.delete(serverUuid);
    try {
      await this.store.deleteByServerUuid(serverUuid);
    } catch (error) {
      logger.error(
        `Error dropping the snapshot of MCP server ${serverUuid}:`,
        error,
      );
    }
  }
}

export const serverSnapshots = new ServerSnapshots(
  mcpServerSnapshotsRepository,
  nonNegativeIntFromEnv(process.env.MCP_TOOLS_CACHE_TTL, 24 * 60 * 60 * 1000),
);
