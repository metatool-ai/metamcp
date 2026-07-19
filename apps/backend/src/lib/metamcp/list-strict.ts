import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Decide whether a fully-degraded aggregate list must be reported as an error.
 *
 * The degraded-response tripwire in the list handlers already logs when a
 * backend server drops out of an aggregate response. But when EVERY server
 * fails, the client receives an empty list with no error at all: from the
 * client's side that is indistinguishable from "this namespace legitimately
 * has no tools". A client starting up during a backend restart therefore sees
 * nothing and is told nothing — it cannot even retry, because as far as it
 * knows the request succeeded.
 *
 * Returns the error to throw, or null when the response should stand as-is.
 * Deliberately pure (no config lookup, no I/O) so the decision is directly
 * testable; the caller gates it on the MCP_LIST_STRICT config key.
 *
 * Partial results are deliberately NOT turned into errors: if at least one
 * server answered, that partial truth still beats a hard failure — the
 * tradeoff the existing tripwire comment documents.
 */
export function listStrictError(
  method: string,
  namespaceUuid: string,
  failedServers: string[],
  resultCount: number,
): McpError | null {
  if (failedServers.length === 0) return null;
  if (resultCount > 0) return null;

  return new McpError(
    ErrorCode.InternalError,
    `${method} failed for namespace ${namespaceUuid}: all ${failedServers.length} backend server(s) failed (${failedServers.join(", ")}) and no results could be aggregated`,
  );
}
