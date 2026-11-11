import crypto from "crypto";

/**
 * Simple in-memory cache for tool synchronization
 * Tracks the hash of tools per MCP server to avoid unnecessary DB operations
 */
type SyncableTool = {
  name: string;
  description?: string | null;
  inputSchema?: unknown;
  annotations?: Record<string, unknown> | null;
};

export class ToolsSyncCache {
  private cache: Map<string, string> = new Map();

  /** Hash all persisted client-visible tool fields, not just names. */
  hashTools(tools: Array<SyncableTool | string>): string {
    const canonical = [...tools]
      .map((tool) =>
        typeof tool === "string"
          ? {
              name: tool,
              description: "",
              inputSchema: null,
              annotations: null,
            }
          : {
              name: tool.name,
              description: tool.description ?? "",
              inputSchema: tool.inputSchema ?? null,
              annotations: tool.annotations ?? null,
            },
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex");
  }

  /**
   * Check if tools have changed since last sync
   * @returns true if tools changed or no cache exists, false if unchanged
   */
  hasChanged(
    mcpServerUuid: string,
    tools: Array<SyncableTool | string>,
  ): boolean {
    const currentHash = this.hashTools(tools);
    const cachedHash = this.cache.get(mcpServerUuid);

    return cachedHash !== currentHash;
  }

  /**
   * Update the cache with current tool state
   */
  update(mcpServerUuid: string, tools: Array<SyncableTool | string>): void {
    const hash = this.hashTools(tools);
    this.cache.set(mcpServerUuid, hash);
  }

  /**
   * Check if sync is needed and update cache if it is
   * @returns true if sync needed, false if cache hit
   */
  shouldSync(
    mcpServerUuid: string,
    tools: Array<SyncableTool | string>,
  ): boolean {
    const needsSync = this.hasChanged(mcpServerUuid, tools);

    if (needsSync) {
      this.update(mcpServerUuid, tools);
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
