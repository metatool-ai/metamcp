import crypto from "crypto";

/**
 * Simple in-memory cache for tool synchronization
 * Tracks the hash of tools per MCP server to avoid unnecessary DB operations
 */
export class ToolsSyncCache {
  private cache: Map<string, string> = new Map();

  /**
   * Generate a hash from tool names
   * Only tool names are used since they uniquely identify tools per server
   */
  hashTools(toolNames: string[]): string {
    // Sort to ensure consistent hash regardless of order
    const sorted = [...toolNames].sort();
    const joined = sorted.join("|");
    return crypto.createHash("sha256").update(joined).digest("hex");
  }

  /**
   * Check if tools have changed since last sync
   * @returns true if tools changed or no cache exists, false if unchanged
   */
  hasChanged(mcpServerUuid: string, toolNames: string[]): boolean {
    const currentHash = this.hashTools(toolNames);
    const cachedHash = this.cache.get(mcpServerUuid);

    return cachedHash !== currentHash;
  }

  /**
   * Update the cache with current tool state
   */
  update(mcpServerUuid: string, toolNames: string[]): void {
    const hash = this.hashTools(toolNames);
    this.cache.set(mcpServerUuid, hash);
  }

  /**
   * Check if sync is needed and update cache if it is
   * @returns true if sync needed, false if cache hit
   */
  shouldSync(mcpServerUuid: string, toolNames: string[]): boolean {
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
