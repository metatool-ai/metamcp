/**
 * Detect errors that indicate the backend MCP server's session registry no
 * longer knows our Mcp-Session-Id. Per the MCP Streamable HTTP spec, the
 * backend SHOULD respond with HTTP 404 when it cannot find the session; most
 * SDKs also surface a JSON-RPC error body with code -32001 or -32600 and
 * message "Session not found".
 *
 * The MCP TypeScript SDK's StreamableHTTPClientTransport wraps this as a
 * generic Error whose message embeds the HTTP status and raw JSON-RPC body,
 * so we match on substrings. Example:
 *
 *   Error POSTing to endpoint (HTTP 404):
 *   {"jsonrpc":"2.0","id":"server-error","error":{"code":-32600,"message":"Session not found"}}
 *
 * Production observation 2026-05-08: in some flows the SDK error reaches us
 * wrapped (e.g. via `.cause` from a higher-layer handler, or stringified
 * after passing through a non-Error rejection). The simple
 * `error.message.includes(...)` check missed all 138 events emitted between
 * a backend container restart and a manual MetaMCP restart, even though the
 * rendered string clearly contained all three matched substrings. To prevent
 * that gap from re-opening on the next backend deploy, this detector now:
 *
 *   1. Walks the `.cause` chain on Error inputs (max depth 8).
 *   2. Falls back to `String(error)` for non-Error throwables (some SDK
 *      paths reject with plain objects, McpError wrappers, or strings).
 *   3. Inspects a numeric/string `.code` field on object inputs (some
 *      RPC layers strip the message but preserve the code).
 *
 * When this fires, the cached backend connection is dead: MetaMCP must drop
 * it, send a new `initialize`, and replay the failed request. The MCP spec
 * states the client MUST start a new session in response to HTTP 404, so
 * this is the normative recovery path, not a workaround.
 */

const SESSION_NOT_FOUND = "Session not found";
const HTTP_404 = "HTTP 404";
const RPC_CODE_PATTERNS = ["-32001", "-32600"];
const MAX_CAUSE_DEPTH = 8;

// Transport-disconnect signal raised by the MCP TypeScript SDK's Protocol
// class when a request is dispatched on a transport that has already been
// torn down. Produced verbatim ("Not connected") whenever the cached
// ConnectedClient's underlying StreamableHTTPClientTransport has been
// closed — either because the backend MCP container restarted (Watchtower
// image pull, manual `docker restart`, OOM kill) or because the SDK's
// session manager half-closed the stream after an idle / error condition.
//
// Distinct from "Session not found": the session-not-found path means the
// backend rejected the request because its session registry doesn't know
// our Mcp-Session-Id (recoverable by sending a new `initialize`). The
// "Not connected" path means our local transport has no live stream to
// send anything on (recoverable by invalidating the pool entry, opening
// a fresh transport, and re-initializing). Both end up at the same
// recovery action — invalidate + reconnect + retry — but the error
// envelopes are textually disjoint, so they need separate detectors.
const NOT_CONNECTED = "Not connected";
// JSON-RPC code -32603 = "Internal error". MetaMCP's tRPC bridge wraps
// the SDK-thrown "Not connected" rejection into this envelope before it
// reaches the consumer (Claude.ai connector, n8n httpRequest node, etc.).
// Production observation 2026-05-14: consumer-side connectors see
// `-32603 "Not connected"` rather than the raw SDK Error, and the
// session-lost detector misses it. Pair the code with the
// "Not connected" message so we don't false-positive on every -32603
// from unrelated internal-error paths.
const RPC_CODE_TRANSPORT_LOST = "-32603";

function stringMatchesSessionLost(value: string): boolean {
  const mentionsSessionNotFound = value.includes(SESSION_NOT_FOUND);
  const mentionsHttp404 = value.includes(HTTP_404);
  const mentionsSessionErrorCode = RPC_CODE_PATTERNS.some((code) =>
    value.includes(code),
  );
  return (
    mentionsSessionNotFound && (mentionsHttp404 || mentionsSessionErrorCode)
  );
}

function objectHasSessionLostCode(candidate: unknown): boolean {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const code = (candidate as { code?: unknown }).code;
  if (typeof code === "number") {
    return code === -32001 || code === -32600;
  }
  if (typeof code === "string") {
    return code === "-32001" || code === "-32600";
  }
  return false;
}

function stringMatchesTransportLost(value: string): boolean {
  // The "Not connected" substring is the load-bearing marker; the
  // -32603 code is only a confirming signal when present in a JSON-RPC
  // envelope. A bare "Not connected" message from the SDK is sufficient.
  return value.includes(NOT_CONNECTED);
}

function objectHasTransportLostCode(candidate: unknown): boolean {
  // Only match -32603 when the rendered/structured object also carries
  // the "Not connected" marker — bare -32603 is JSON-RPC "Internal
  // error" and covers many unrelated failure modes.
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const obj = candidate as { code?: unknown; message?: unknown };
  const code = obj.code;
  const isTransportCode =
    code === -32603 ||
    code === "-32603" ||
    (typeof code === "string" && code.includes(RPC_CODE_TRANSPORT_LOST));
  if (!isTransportCode) {
    return false;
  }
  if (
    typeof obj.message === "string" &&
    stringMatchesTransportLost(obj.message)
  ) {
    return true;
  }
  try {
    return stringMatchesTransportLost(JSON.stringify(candidate));
  } catch {
    return false;
  }
}

/**
 * Detect errors that indicate the cached backend client's transport is dead.
 *
 * Sibling of {@link isBackendSessionLostError}. The session-lost detector
 * matches the backend's "I don't know your Mcp-Session-Id" response (HTTP
 * 404 + JSON-RPC -32001/-32600 + "Session not found"). The transport-lost
 * detector matches the SDK's local "I have no live stream to send on"
 * rejection, surfaced as a bare `"Not connected"` Error from
 * `Protocol.request()` and also as a `-32603 "Not connected"` JSON-RPC
 * envelope on the consumer-facing side.
 *
 * When this fires, the recovery action is identical to the session-lost
 * path: invalidate the pooled `ConnectedClient`, open a fresh transport,
 * re-initialize, and replay the request once. The two detectors are kept
 * separate (rather than collapsed into one OR-of-substrings function) so
 * each has a tight predicate that doesn't false-positive on the much
 * larger noise floor of unrelated -32603 / 404 errors.
 *
 * Production observation 2026-05-14: rapid-deploy cadence on the autotask
 * MCP backend (Watchtower pulls + container restarts within a 5-min
 * window) produced disconnect windows where the consumer-side connector
 * saw `-32603 "Not connected"` on every call. The session-lost detector
 * missed all of these; the recovery path in `metamcp-proxy.ts` never
 * fired. Operator quote (2026-05-14): "It's not acceptable for having
 * MCP servers down or needing reboots after small change applications."
 * This detector + the matching recovery wiring in `metamcp-proxy.ts`
 * close that gap.
 */
export function isBackendTransportLostError(error: unknown): boolean {
  if (error == null) {
    return false;
  }

  if (typeof error === "string") {
    return stringMatchesTransportLost(error);
  }

  let current: unknown = error;
  let depth = 0;
  const seen = new Set<unknown>();
  while (current != null && depth < MAX_CAUSE_DEPTH) {
    if (seen.has(current)) {
      // Circular .cause chain — bail out.
      break;
    }
    seen.add(current);

    if (current instanceof Error) {
      if (current.message && stringMatchesTransportLost(current.message)) {
        return true;
      }
      if (objectHasTransportLostCode(current)) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
      depth += 1;
      continue;
    }

    if (typeof current === "object") {
      const obj = current as { message?: unknown };
      if (
        typeof obj.message === "string" &&
        stringMatchesTransportLost(obj.message)
      ) {
        return true;
      }
      if (objectHasTransportLostCode(current)) {
        return true;
      }
      try {
        const rendered = JSON.stringify(current);
        if (stringMatchesTransportLost(rendered)) {
          return true;
        }
      } catch {
        // Non-serializable; fall through.
      }
      break;
    }
    break;
  }

  try {
    return stringMatchesTransportLost(String(error));
  } catch {
    return false;
  }
}

/**
 * Convenience predicate — either the session-lost OR transport-lost
 * detector fires. Tool-call and dynamic-find recovery paths in
 * `metamcp-proxy.ts` use this so they engage the same invalidate +
 * reconnect + retry sequence regardless of which envelope the failure
 * arrived in.
 */
export function isRecoverableBackendError(error: unknown): boolean {
  return isBackendSessionLostError(error) || isBackendTransportLostError(error);
}

export function isBackendSessionLostError(error: unknown): boolean {
  if (error == null) {
    return false;
  }

  // String inputs (some rejection paths surface a bare string).
  if (typeof error === "string") {
    return stringMatchesSessionLost(error);
  }

  // Walk Error.cause chain — match any link in the chain.
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < MAX_CAUSE_DEPTH) {
    if (current instanceof Error) {
      if (current.message && stringMatchesSessionLost(current.message)) {
        return true;
      }
      if (objectHasSessionLostCode(current)) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
      depth += 1;
      continue;
    }
    if (typeof current === "object") {
      // Plain object (e.g. JSON-RPC error envelope): inspect message + code.
      const obj = current as { message?: unknown; code?: unknown };
      if (
        typeof obj.message === "string" &&
        stringMatchesSessionLost(obj.message)
      ) {
        return true;
      }
      if (objectHasSessionLostCode(obj)) {
        return true;
      }
      // Last-ditch: render the whole object and substring-match. Catches
      // shapes like `{ jsonrpc, id, error: { code, message } }` where the
      // session-not-found markers live one level deep.
      try {
        const rendered = JSON.stringify(current);
        if (stringMatchesSessionLost(rendered)) {
          return true;
        }
      } catch {
        // Circular structure or non-serializable; ignore.
      }
      break;
    }
    break;
  }

  // Final fallback: stringify the original input. Covers throwables that
  // implement only `toString()` (e.g. some legacy transports emit a
  // class with a meaningful String(...) representation but no message).
  try {
    return stringMatchesSessionLost(String(error));
  } catch {
    return false;
  }
}
