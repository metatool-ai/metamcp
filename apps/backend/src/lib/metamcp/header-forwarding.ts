import {
  DENIED_FORWARD_HEADERS,
  DENIED_HEADER_PREFIXES,
  ServerParameters,
} from "@repo/zod-types";
import { IncomingHttpHeaders } from "http";

import logger from "@/utils/logger";

/**
 * Strips CRLF and null-byte characters from header values to prevent
 * HTTP response splitting and null-byte truncation attacks.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]/g, "");
}

/**
 * Extracts client request headers into a flat Record, suitable for
 * later filtering by extractForwardedHeaders.
 *
 * This is the single extraction point used by both SSE and StreamableHTTP routers.
 */
export function extractClientHeaders(
  incomingHeaders: IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(", ");
    }
  }
  return result;
}

/**
 * Extracts headers from a client request that should be forwarded
 * to backend MCP servers, based on each server's `forward_headers` config.
 *
 * Denied headers (host, cookie, etc.) are silently skipped even if
 * configured in `forward_headers`.
 *
 * @param clientHeaders - The raw request headers from the client
 * @param serverParams - Map of serverUuid -> ServerParameters
 * @returns Map of serverUuid -> headers to forward
 */
export function extractForwardedHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  serverParams: Record<string, ServerParameters>,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const [uuid, params] of Object.entries(serverParams)) {
    if (
      !params.forward_headers ||
      Object.keys(params.forward_headers).length === 0
    ) {
      continue;
    }

    const forwarded: Record<string, string> = {};
    for (const [clientHeaderName, serverHeaderName] of Object.entries(
      params.forward_headers,
    )) {
      const lowerName = clientHeaderName.toLowerCase();

      // Skip denied headers for security (exact match + prefix match)
      if (
        DENIED_FORWARD_HEADERS.has(lowerName) ||
        DENIED_HEADER_PREFIXES.some((p) => lowerName.startsWith(p))
      ) {
        continue;
      }

      // HTTP headers are case-insensitive; Node.js lowercases them
      const value = clientHeaders[lowerName];
      if (value !== undefined && value !== null) {
        const raw = Array.isArray(value) ? value[0] : value;
        forwarded[serverHeaderName] = sanitizeHeaderValue(raw);
      }
    }

    if (Object.keys(forwarded).length > 0) {
      result[uuid] = forwarded;
      // Audit log: record which header names were forwarded (values are redacted).
      // Using debug level since this fires per-handler, not just per-session.
      logger.debug(
        `Forwarding headers to server ${uuid}: [${Object.keys(forwarded).join(", ")}]`,
      );
    }
  }

  return result;
}

/**
 * Merges forwarded (per-request) headers into a server's static headers.
 * Forwarded headers take precedence over static headers.
 *
 * @param staticHeaders - Headers from the DB (mcp_servers.headers)
 * @param forwardedHeaders - Headers extracted from the client request
 * @returns Merged headers
 */
export function mergeHeaders(
  staticHeaders: Record<string, string> | null | undefined,
  forwardedHeaders: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...(staticHeaders || {}),
    ...(forwardedHeaders || {}),
  };
}

/**
 * Checks whether a server requires per-request header forwarding.
 * Servers with forward_headers configured cannot use idle/pooled connections.
 */
export function serverRequiresForwardedHeaders(
  params: ServerParameters,
): boolean {
  return (
    !!params.forward_headers &&
    typeof params.forward_headers === "object" &&
    Object.keys(params.forward_headers).length > 0
  );
}

/**
 * Checks whether ANY server in a set requires forwarded headers.
 * Used to decide whether idle pool reuse should be skipped at the namespace level.
 */
export function anyServerRequiresForwardedHeaders(
  serverParams: Record<string, ServerParameters>,
): boolean {
  return Object.values(serverParams).some(serverRequiresForwardedHeaders);
}
