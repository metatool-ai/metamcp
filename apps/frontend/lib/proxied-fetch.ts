import { vanillaTrpcClient } from "./trpc";

// Statuses for which the Response constructor forbids a body.
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * Returns a fetch-compatible function (FetchLike) that routes the request
 * through the MetaMCP backend (server-to-server) instead of issuing it from the
 * browser.
 *
 * Used for the OAuth flow against an upstream MCP server — discovery, dynamic
 * client registration, and token exchange/refresh. Performing those from the
 * browser fails for any provider that doesn't send CORS headers (common for
 * enterprise OAuth servers); doing them server-side avoids CORS entirely. The
 * backend also transparently works around providers that advertise a broken
 * protected-resource metadata URL.
 */
export function createProxiedFetch(mcpServerUuid: string) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
      });
    }

    let body: string | undefined;
    if (init?.body != null) {
      body =
        typeof init.body === "string"
          ? init.body
          : init.body instanceof URLSearchParams
            ? init.body.toString()
            : String(init.body);
    }

    const result = await vanillaTrpcClient.frontend.oauth.proxyFetch.mutate({
      mcp_server_uuid: mcpServerUuid,
      url,
      method,
      headers,
      body,
    });

    if (!result.success) {
      throw new Error(`OAuth proxy fetch failed: ${result.error}`);
    }

    return new Response(
      NULL_BODY_STATUS.has(result.status) ? null : result.body,
      {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      },
    );
  };
}
