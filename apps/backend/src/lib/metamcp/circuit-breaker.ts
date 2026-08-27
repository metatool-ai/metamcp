import logger from "@/utils/logger";

/**
 * Per-backend circuit breaker.
 *
 * If a backend MCP server times out N times in a row, it is "tripped" and
 * excluded from tool aggregation for a cooldown window (so the sync loop and
 * tools/list don't keep hammering a dead/slow backend). After the cooldown it
 * transitions to "half-open": one probe request is allowed; if it succeeds the
 * breaker resets, if it fails it re-trips for another window.
 *
 * Keyed by server UUID. In-memory only (resets on restart, which is fine — a
 * restart clears error state anyway).
 */

interface BreakerState {
  consecutiveFailures: number;
  trippedUntil: number | null; // epoch ms while OPEN
  halfOpenProbe: boolean; // a probe is in-flight while HALF_OPEN
}

const DEFAULT_FAIL_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;

class CircuitBreaker {
  private readonly states: Map<string, BreakerState> = new Map();
  private readonly failThreshold: number;
  private readonly cooldownMs: number;

  constructor(
    failThreshold: number = parseInt(
      process.env.MCP_BREAKER_FAIL_THRESHOLD || `${DEFAULT_FAIL_THRESHOLD}`,
      10,
    ),
    cooldownMs: number = parseInt(
      process.env.MCP_BREAKER_COOLDOWN_MS || `${DEFAULT_COOLDOWN_MS}`,
      10,
    ),
  ) {
    this.failThreshold = failThreshold;
    this.cooldownMs = cooldownMs;
  }

  private state(serverUuid: string): BreakerState {
    let s = this.states.get(serverUuid);
    if (!s) {
      s = { consecutiveFailures: 0, trippedUntil: null, halfOpenProbe: false };
      this.states.set(serverUuid, s);
    }
    return s;
  }

  /** Should we avoid initiating work against this server right now? */
  isOpen(serverUuid: string): boolean {
    const s = this.state(serverUuid);
    if (s.trippedUntil === null) return false;
    if (Date.now() < s.trippedUntil) return true;
    // Cooldown elapsed → HALF_OPEN: allow a probe (the first request through).
    return false;
  }

  /** Mark a successful request against the server — reset the breaker. */
  onSuccess(serverUuid: string): void {
    const s = this.state(serverUuid);
    s.consecutiveFailures = 0;
    s.trippedUntil = null;
    s.halfOpenProbe = false;
  }

  /** Mark a timed-out / failed request — count toward tripping. */
  onFailure(serverUuid: string): void {
    const s = this.state(serverUuid);
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.failThreshold) {
      s.trippedUntil = Date.now() + this.cooldownMs;
      s.halfOpenProbe = false;
      logger.warn(
        `[circuit-breaker] server ${serverUuid} tripped for ${this.cooldownMs}ms after ${s.consecutiveFailures} consecutive failures`,
      );
    }
  }

  /** Clear the breaker for a server (e.g. on manual recovery). */
  reset(serverUuid: string): void {
    this.states.delete(serverUuid);
  }

  getState(serverUuid: string): BreakerState | undefined {
    return this.states.get(serverUuid);
  }
}

export const circuitBreaker = new CircuitBreaker();
