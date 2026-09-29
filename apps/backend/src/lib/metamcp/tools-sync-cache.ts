import crypto from "crypto";

/** A tool as persisted (name, description, input schema), or just a name. */
export type SyncedTool =
  | string
  | { name: string; description?: string; inputSchema?: unknown };

/** JSON with sorted object keys, so equal schemas always hash the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Simple in-memory cache for tool synchronization
 * Tracks the hash of tools per MCP server to avoid unnecessary DB operations
 */
export class ToolsSyncCache {
  private cache: Map<string, string> = new Map();

  /**
   * Hash of the tools of a server. Descriptions and input schemas are part
   * of it: they are stored too, so a change must trigger a new sync.
   */
  hashTools(tools: readonly SyncedTool[]): string {
    const serialized = tools
      .map((tool) =>
        typeof tool === "string"
          ? tool
          : stableStringify({
              name: tool.name,
              description: tool.description ?? "",
              inputSchema: tool.inputSchema ?? null,
            }),
      )
      // Sort to ensure consistent hash regardless of order
      .sort();
    return crypto
      .createHash("sha256")
      .update(serialized.join("\u0000"))
      .digest("hex");
  }

  /**
   * Check if tools have changed since last sync
   * @returns true if tools changed or no cache exists, false if unchanged
   */
  hasChanged(mcpServerUuid: string, toolNames: readonly SyncedTool[]): boolean {
    const currentHash = this.hashTools(toolNames);
    const cachedHash = this.cache.get(mcpServerUuid);

    return cachedHash !== currentHash;
  }

  /**
   * Update the cache with current tool state
   */
  update(mcpServerUuid: string, toolNames: readonly SyncedTool[]): void {
    const hash = this.hashTools(toolNames);
    this.cache.set(mcpServerUuid, hash);
  }

  /**
   * Check if sync is needed and update cache if it is
   * @returns true if sync needed, false if cache hit
   */
  shouldSync(mcpServerUuid: string, toolNames: readonly SyncedTool[]): boolean {
    const needsSync = this.hasChanged(mcpServerUuid, toolNames);

    if (needsSync) {
      this.update(mcpServerUuid, toolNames);
    }

    return needsSync;
  }

  /**
   * Clear cache for specific server or entire cache
   */
  clear(mcpServerUuid?: string): void {
    if (mcpServerUuid) {
      this.cache.delete(mcpServerUuid);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    servers: string[];
  } {
    return {
      size: this.cache.size,
      servers: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const toolsSyncCache = new ToolsSyncCache();
