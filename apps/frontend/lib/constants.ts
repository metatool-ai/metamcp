// OAuth-related session storage keys
export const SESSION_KEYS = {
  CODE_VERIFIER: "mcp_code_verifier",
  SERVER_URL: "mcp_server_url",
  TOKENS: "mcp_tokens",
  CLIENT_INFORMATION: "mcp_client_information",
  MCP_SERVER_UUID: "mcp_server_uuid",
  SERVER_METADATA: "mcp_server_metadata",
} as const;

// Helper function to create server-specific session storage keys
export function getServerSpecificKey(
  baseKey: string,
  serverUrl: string,
): string {
  return `${baseKey}_${btoa(serverUrl).replace(/[^a-zA-Z0-9]/g, "")}`;
}

export type ConnectionStatus =
  | "connecting"
  | "disconnected"
  | "connected"
  | "error"
  | "error-connecting-to-proxy";

/**
 * Sent on every request to the backend inspector proxy (/mcp-proxy), which
 * rejects requests without it: a cross-site page cannot add this header, so
 * it cannot open inspector sessions with the user's cookies.
 */
export const INSPECTOR_HEADERS: Readonly<Record<string, string>> = {
  "X-MetaMCP-Inspector": "1",
};
