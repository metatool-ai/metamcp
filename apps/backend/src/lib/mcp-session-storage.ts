/**
 * Session storage for tracking OAuth client information per MCP session
 * This allows MCP request handlers to know which OAuth client made the request
 */

interface SessionInfo {
  clientId: string | null;
  userId: string | null;
  authMethod: "api_key" | "oauth" | null;
  endpointName: string;
  namespaceUuid: string;
  createdAt: number;
}

class McpSessionStorage {
  private sessions: Map<string, SessionInfo> = new Map();

  /**
   * Store session information
   */
  setSession(sessionId: string, info: SessionInfo): void {
    this.sessions.set(sessionId, info);
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove session information
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Cleanup old sessions (older than 24 hours)
   */
  cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [sessionId, info] of this.sessions.entries()) {
      if (now - info.createdAt > maxAge) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Get all session IDs for a client
   */
  getSessionsByClient(clientId: string): string[] {
    const sessionIds: string[] = [];
    for (const [sessionId, info] of this.sessions.entries()) {
      if (info.clientId === clientId) {
        sessionIds.push(sessionId);
      }
    }
    return sessionIds;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byAuthMethod: Record<string, number>;
    byClientId: Record<string, number>;
  } {
    const stats = {
      total: this.sessions.size,
      byAuthMethod: {} as Record<string, number>,
      byClientId: {} as Record<string, number>,
    };

    for (const info of this.sessions.values()) {
      const authMethod = info.authMethod || "none";
      stats.byAuthMethod[authMethod] = (stats.byAuthMethod[authMethod] || 0) + 1;

      if (info.clientId) {
        stats.byClientId[info.clientId] =
          (stats.byClientId[info.clientId] || 0) + 1;
      }
    }

    return stats;
  }
}

export const mcpSessionStorage = new McpSessionStorage();

// Cleanup old sessions every hour
setInterval(
  () => {
    mcpSessionStorage.cleanupOldSessions();
  },
  60 * 60 * 1000,
); // 1 hour
