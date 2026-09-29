import logger from "@/utils/logger";

import { configService } from "./config.service";

export interface SessionLifetimeManager<T> {
  addSession(sessionId: string, session: T): void;
  removeSession(sessionId: string): void;
  getSession(sessionId: string): T | undefined;
  getAllSessions(): Map<string, T>;
  getSessionAge(sessionId: string): number | undefined;
  isSessionExpired(sessionId: string): Promise<boolean>;
  cleanupExpiredSessions(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
  ): Promise<void>;
  startCleanupTimer(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
    intervalMs?: number,
  ): void;
  stopCleanupTimer(): void;
}

export type SessionLifetimeOptions = {
  /**
   * Expire sessions that saw no request for this long (ms). A session with a
   * request still open (e.g. a GET notification stream) is never idle. Null
   * or 0: only SESSION_LIFETIME applies.
   */
  idleTimeoutMs?: number | null;
};

/** Reads a non-negative integer (e.g. a duration in ms) from the environment. */
export function nonNegativeIntFromEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export class SessionLifetimeManagerImpl<
  T,
> implements SessionLifetimeManager<T> {
  private sessions: Map<string, T> = new Map();
  private sessionTimestamps: Map<string, number> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private openRequests: Map<string, number> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly name: string;
  private readonly idleTimeoutMs: number | null;

  constructor(name: string, options: SessionLifetimeOptions = {}) {
    this.name = name;
    this.idleTimeoutMs = options.idleTimeoutMs || null;
  }

  addSession(sessionId: string, session: T): void {
    const now = Date.now();
    this.sessions.set(sessionId, session);
    this.sessionTimestamps.set(sessionId, now);
    this.lastActivity.set(sessionId, now);
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.sessionTimestamps.delete(sessionId);
    this.lastActivity.delete(sessionId);
    this.openRequests.delete(sessionId);
  }

  /**
   * Counts a request on the session as in flight until `res` closes, and
   * records the activity for the idle timeout.
   */
  trackRequest(
    sessionId: string,
    res: { once(event: "close", listener: () => void): unknown },
  ): void {
    if (!this.sessions.has(sessionId)) return;
    this.lastActivity.set(sessionId, Date.now());
    this.openRequests.set(
      sessionId,
      (this.openRequests.get(sessionId) ?? 0) + 1,
    );
    res.once("close", () => {
      if (!this.sessions.has(sessionId)) return;
      const open = (this.openRequests.get(sessionId) ?? 1) - 1;
      if (open > 0) {
        this.openRequests.set(sessionId, open);
      } else {
        this.openRequests.delete(sessionId);
      }
      this.lastActivity.set(sessionId, Date.now());
    });
  }

  /** Time since the session was last used; 0 while a request is open. */
  getIdleTime(sessionId: string): number | undefined {
    if (!this.sessions.has(sessionId)) return undefined;
    if (this.openRequests.has(sessionId)) return 0;
    const last = this.lastActivity.get(sessionId);
    return last === undefined ? undefined : Date.now() - last;
  }

  /**
   * The least recently used session among `sessionIds` that has no request
   * in flight, i.e. the one that can be dropped with the least disruption.
   */
  leastRecentlyUsed(sessionIds: Iterable<string>): string | undefined {
    let candidate: string | undefined;
    let oldest = Infinity;
    for (const sessionId of sessionIds) {
      if (!this.sessions.has(sessionId) || this.openRequests.has(sessionId)) {
        continue;
      }
      const last = this.lastActivity.get(sessionId) ?? 0;
      if (last < oldest) {
        oldest = last;
        candidate = sessionId;
      }
    }
    return candidate;
  }

  getSession(sessionId: string): T | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): Map<string, T> {
    return new Map(this.sessions);
  }

  getSessionAge(sessionId: string): number | undefined {
    const timestamp = this.sessionTimestamps.get(sessionId);
    return timestamp ? Date.now() - timestamp : undefined;
  }

  async isSessionExpired(sessionId: string): Promise<boolean> {
    const age = this.getSessionAge(sessionId);
    if (age === undefined) return false;

    const sessionLifetime = await configService.getSessionLifetime();
    // If session lifetime is null, sessions are infinite and never expire
    if (sessionLifetime === null) return false;

    return age > sessionLifetime;
  }

  async cleanupExpiredSessions(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
  ): Promise<void> {
    try {
      const sessionLifetime = await configService.getSessionLifetime();

      // Without a lifetime nor an idle timeout, sessions never expire
      if (sessionLifetime === null && this.idleTimeoutMs === null) {
        return;
      }

      const now = Date.now();
      const expiredSessions: Array<{ sessionId: string; session: T }> = [];

      // Find expired sessions: past their lifetime, or idle for too long
      for (const [sessionId, timestamp] of this.sessionTimestamps.entries()) {
        const idleTime = this.getIdleTime(sessionId) ?? 0;
        const expired =
          (sessionLifetime !== null && now - timestamp > sessionLifetime) ||
          (this.idleTimeoutMs !== null && idleTime > this.idleTimeoutMs);
        if (expired) {
          const session = this.sessions.get(sessionId);
          if (session) {
            expiredSessions.push({ sessionId, session });
          }
        }
      }

      // Clean up expired sessions
      if (expiredSessions.length > 0) {
        logger.info(
          `Cleaning up ${expiredSessions.length} expired ${this.name} sessions: ${expiredSessions.map((s) => s.sessionId).join(", ")}`,
        );

        await Promise.allSettled(
          expiredSessions.map(({ sessionId, session }) =>
            cleanupCallback(sessionId, session),
          ),
        );
      }
    } catch (error) {
      logger.error(
        `Error during automatic ${this.name} session cleanup:`,
        error,
      );
    }
  }

  startCleanupTimer(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
    intervalMs: number = 5 * 60 * 1000, // Default: 5 minutes
  ): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupExpiredSessions(cleanupCallback);
    }, intervalMs);
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // Utility methods for getting session counts and IDs
  getSessionCount(): number {
    return this.sessions.size;
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  getSessionTimestamps(): Map<string, number> {
    return new Map(this.sessionTimestamps);
  }
}
