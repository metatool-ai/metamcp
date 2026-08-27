import { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import { circuitBreaker } from "./circuit-breaker";
import { ConnectedClient } from "./client";
import { isRecoverableBackendError } from "./session-error";

/**
 * Cooldown between recoveries for the same server. Prevents a backend that
 * keeps reporting session-lost from being invalidated + re-spawned on every
 * request in a tight loop — the "hang" where each call spawns a fresh process
 * that is also unhealthy, until the client's deadline. A server is recovered
 * at most once per window; a request that hits the cooldown surfaces a clean
 * retryable error instead of blocking on another spawn.
 */
const RECOVERY_COOLDOWN_MS = parseInt(
  process.env.MCP_RECOVERY_COOLDOWN_MS || "10000",
  10,
);

/** Last recovery time per serverUuid (in-memory). */
const lastRecoveredAt = new Map<string, number>();

function isRecoveryCooldownActive(serverUuid: string): boolean {
  const last = lastRecoveredAt.get(serverUuid);
  return last !== undefined && Date.now() - last < RECOVERY_COOLDOWN_MS;
}

/** Reset the recovery cooldown map (test isolation). */
export function resetRecoveryCooldowns(): void {
  lastRecoveredAt.clear();
}

/**
 * Minimal slice of McpServerPool the recovery wrapper needs. Structural
 * so tests can drive the wrapper with a fake pool.
 */
export interface RecoverySessionPool {
  invalidateServerConnection(
    sessionId: string,
    serverUuid: string,
  ): Promise<void>;
  getSession(
    sessionId: string,
    serverUuid: string,
    params: ServerParameters,
    namespaceUuid?: string,
  ): Promise<ConnectedClient | undefined>;
}

export interface RequestWithSessionRecoveryOptions<T> {
  pool: RecoverySessionPool;
  sessionId: string;
  serverUuid: string;
  params: ServerParameters;
  namespaceUuid?: string;
  /** Operation label for log lines, e.g. "tools/list". */
  operation: string;
  /** Human-readable server name for log lines. */
  serverName: string;
  /** The (possibly stale) pooled session the caller already holds. */
  session: ConnectedClient;
  /**
   * The actual backend request(s). Re-invoked exactly once on a fresh
   * session if the first invocation fails with a recoverable backend
   * error (session-lost / transport-lost envelope).
   */
  attempt: (session: ConnectedClient) => Promise<T>;
  /**
   * Called when recovery swapped in a fresh session — lets the caller
   * repoint tool/prompt/resource maps to the new client.
   */
  onFreshSession?: (session: ConnectedClient) => void;
}

/**
 * Invalidate-and-retry-once recovery cascade for the per-server fetch
 * inside the aggregate list handlers (tools/list, prompts/list,
 * resources/list, resources/templates/list).
 *
 * The aggregate list handlers previously logged-and-continued in their
 * catch blocks, so a dead pooled session (e.g. after a restart of the
 * backend container) made the namespace return a "successful" 0-tool
 * response on every request, forever — the swallowed error meant the
 * zombie connection was never invalidated.
 *
 * Throws when the error is non-recoverable, when no fresh session could
 * be established, or when the retry on the fresh session fails — the
 * caller decides whether that excludes one server from an aggregate
 * response (and tracks it as degraded) or fails the request.
 */
export async function requestWithSessionRecovery<T>(
  opts: RequestWithSessionRecoveryOptions<T>,
): Promise<T> {
  try {
    return await opts.attempt(opts.session);
  } catch (error) {
    if (!isRecoverableBackendError(error)) {
      throw error;
    }

    // Circuit breaker: a tripped server must not be spawned into repeatedly.
    // Surface a clean recoverable-exit error instead; the caller marks the
    // server degraded/pending and the breaker's half-open probe lets a real
    // request through once the cooldown elapses.
    if (circuitBreaker.isOpen(opts.serverUuid)) {
      throw new Error(
        `Server ${opts.serverUuid} (${opts.serverName}) is circuit-open; skipping reconnect during ${opts.operation}`,
      );
    }

    // Recovery rate-limit: at most one invalidate+re-spawn per window per
    // server. Without it a backend that keeps reporting session-lost spawns
    // a fresh unhealthy process on every request — the endless hang.
    if (isRecoveryCooldownActive(opts.serverUuid)) {
      throw new Error(
        `Server ${opts.serverUuid} (${opts.serverName}) recovered within the last ${RECOVERY_COOLDOWN_MS}ms; skipping reconnect during ${opts.operation}`,
      );
    }

    logger.warn(
      `Backend connection lost for server ${opts.serverUuid} (${opts.serverName}) on ${opts.operation}; invalidating pool and retrying once. (envelope: ${
        error instanceof Error ? error.message : String(error)
      })`,
    );

    // Set the cooldown BEFORE invalidating: two concurrent requests for the
    // same dead server would otherwise both pass the cooldown check, both
    // invalidate, and both spawn a fresh process — re-introducing the storm
    // the cooldown exists to prevent. The second wave then sees the stamp.
    lastRecoveredAt.set(opts.serverUuid, Date.now());
    await opts.pool.invalidateServerConnection(opts.sessionId, opts.serverUuid);

    const fresh = await opts.pool.getSession(
      opts.sessionId,
      opts.serverUuid,
      opts.params,
      opts.namespaceUuid,
    );
    if (!fresh) {
      throw new Error(
        `Failed to re-initialize session for server ${opts.serverUuid} after backend session loss during ${opts.operation}`,
      );
    }

    opts.onFreshSession?.(fresh);
    try {
      return await opts.attempt(fresh);
    } catch (retryError) {
      // Mirror the proxy's call-tool fix (6a7b40d): a recovery retry that
      // throws after registering the fresh session must clean it up, or it
      // leaks in the active slot until the session closes. Keep the original
      // error intact — a cleanup failure must not mask the real failure.
      await opts.pool
        .invalidateServerConnection(opts.sessionId, opts.serverUuid)
        .catch((invalidateError) => {
          logger.error(
            `Error cleaning up leaked fresh session for server ${opts.serverUuid} after failed ${opts.operation} retry:`,
            invalidateError,
          );
        });
      throw retryError;
    }
  }
}
