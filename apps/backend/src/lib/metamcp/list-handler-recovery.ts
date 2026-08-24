import { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import { ConnectedClient } from "./client";
import { isRecoverableBackendError } from "./session-error";

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

    logger.warn(
      `Backend connection lost for server ${opts.serverUuid} (${opts.serverName}) on ${opts.operation}; invalidating pool and retrying once. (envelope: ${
        error instanceof Error ? error.message : String(error)
      })`,
    );

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
    return await opts.attempt(fresh);
  }
}
