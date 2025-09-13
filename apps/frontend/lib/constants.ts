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

// Helper function to safely access sessionStorage (SSR-safe)
export const safeSessionStorage = {
  getItem: (key: string): string | null => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return sessionStorage.getItem(key);
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.setItem(key, value);
    }
  },
  removeItem: (key: string): void => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.removeItem(key);
    }
  }
};

export type ConnectionStatus =
  | "connecting"
  | "disconnected"
  | "connected"
  | "error"
  | "error-connecting-to-proxy";
