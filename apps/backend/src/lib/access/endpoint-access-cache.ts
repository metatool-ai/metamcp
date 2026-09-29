/**
 * Short-lived cache of "may this principal use this namespace" decisions for
 * the MCP data plane (/metamcp/<endpoint>/...), which authorizes every
 * JSON-RPC request. Cleared on any share, membership or role change.
 */
const TTL_MS = 10_000;
const MAX_ENTRIES = 5_000;

class EndpointAccessCache {
  private entries = new Map<string, { allowed: boolean; expiresAt: number }>();
  private clearListeners: Array<() => void> = [];

  /** Other access caches that must be dropped together with this one. */
  onClear(listener: () => void): void {
    this.clearListeners.push(listener);
  }

  get(key: string): boolean | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.allowed;
  }

  set(key: string, allowed: boolean): void {
    if (this.entries.size >= MAX_ENTRIES) {
      this.entries.clear();
    }
    this.entries.set(key, { allowed, expiresAt: Date.now() + TTL_MS });
  }

  clear(): void {
    this.entries.clear();
    for (const listener of this.clearListeners) listener();
  }
}

export const endpointAccessCache = new EndpointAccessCache();
