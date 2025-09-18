import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformation,
  OAuthClientInformationSchema,
  OAuthClientMetadata,
  OAuthMetadata,
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { getServerSpecificKey, SESSION_KEYS } from "./constants";
import { getAppUrl } from "./env";
import { vanillaTrpcClient } from "./trpc";

// OAuth client provider that works with a specific MCP server
class DbOAuthClientProvider implements OAuthClientProvider {
  private mcpServerUuid: string;
  protected serverUrl: string;

  constructor(mcpServerUuid: string, serverUrl: string) {
    this.mcpServerUuid = mcpServerUuid;
    this.serverUrl = serverUrl;
    // Save the server URL to session storage for consistency
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, serverUrl);
  }

  get redirectUrl() {
    return getAppUrl() + "/fe-oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MetaMCP",
      client_uri: "https://github.com/metatool-ai/metamcp",
    };
  }

  // Check if the server exists in the database
  private async serverExists() {
    try {
      const result = await vanillaTrpcClient.frontend.mcpServers.get.query({
        uuid: this.mcpServerUuid,
      });
      return result.success && !!result.data;
    } catch (error) {
      console.error("Error checking server existence:", error);
      return false;
    }
  }

  // During OAuth flow, we use sessionStorage for temporary data
  // After successful authentication, we'll save to the database
  async clientInformation() {
    try {
      // Check if server exists in the database
      const exists = await this.serverExists();

      if (exists) {
        // Get from database if server exists
        const result = await vanillaTrpcClient.frontend.oauth.get.query({
          mcp_server_uuid: this.mcpServerUuid,
        });
        if (result.success && result.data?.client_information) {
          return await OAuthClientInformationSchema.parseAsync(
            result.data.client_information,
          );
        }
      } else {
        // Get from session storage during OAuth flow
        const key = getServerSpecificKey(
          SESSION_KEYS.CLIENT_INFORMATION,
          this.serverUrl,
        );
        const storedInfo = sessionStorage.getItem(key);
        if (storedInfo) {
          return await OAuthClientInformationSchema.parseAsync(
            JSON.parse(storedInfo),
          );
        }
      }

      return undefined;
    } catch (error) {
      console.error("Error retrieving client information:", error);
      return undefined;
    }
  }

  async saveClientInformation(clientInformation: OAuthClientInformation) {
    // Save to session storage during OAuth flow
    const key = getServerSpecificKey(
      SESSION_KEYS.CLIENT_INFORMATION,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(clientInformation));

    // If server exists, also save to database
    if (await this.serverExists()) {
      try {
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          client_information: clientInformation,
        });
      } catch (error) {
        console.error("Error saving client information to database:", error);
      }
    }
  }

  async tokens() {
    try {
      // Check if server exists in the database
      const exists = await this.serverExists();

      if (exists) {
        // Get from database if server exists
        const result = await vanillaTrpcClient.frontend.oauth.get.query({
          mcp_server_uuid: this.mcpServerUuid,
        });
        if (result.success && result.data?.tokens) {
          return await OAuthTokensSchema.parseAsync(result.data.tokens);
        }
      } else {
        // Get from session storage during OAuth flow
        const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
        const storedTokens = sessionStorage.getItem(key);
        if (storedTokens) {
          return await OAuthTokensSchema.parseAsync(JSON.parse(storedTokens));
        }
      }

      return undefined;
    } catch (error) {
      console.error("Error retrieving tokens:", error);
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens) {
    // Save to session storage during OAuth flow
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    sessionStorage.setItem(key, JSON.stringify(tokens));

    // If server exists, also save to database
    if (await this.serverExists()) {
      try {
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          tokens,
        });
      } catch (error) {
        console.error("Error saving tokens to database:", error);
      }
    }
  }

  redirectToAuthorization(authorizationUrl: URL) {
    window.location.href = authorizationUrl.href;
  }

  async saveCodeVerifier(codeVerifier: string) {
    // Save to session storage during OAuth flow
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    sessionStorage.setItem(key, codeVerifier);

    // If server exists, also save to database
    if (await this.serverExists()) {
      try {
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          code_verifier: codeVerifier,
        });
      } catch (error) {
        console.error("Error saving code verifier to database:", error);
      }
    }
  }

  async codeVerifier() {
    // Check if server exists in the database
    const exists = await this.serverExists();

    if (exists) {
      // Get from database if server exists
      try {
        const result = await vanillaTrpcClient.frontend.oauth.get.query({
          mcp_server_uuid: this.mcpServerUuid,
        });
        if (result.success && result.data?.code_verifier) {
          return result.data.code_verifier;
        }
      } catch (error) {
        console.error("Error retrieving code verifier from database:", error);
      }
    }

    // Get from session storage during OAuth flow
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    const codeVerifier = sessionStorage.getItem(key);
    if (!codeVerifier) {
      throw new Error("No code verifier saved for session");
    }

    return codeVerifier;
  }

  clear() {
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CLIENT_INFORMATION, this.serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl),
    );
  }
}

// Debug version that overrides redirect URL and allows saving server OAuth metadata
export class DebugDbOAuthClientProvider extends DbOAuthClientProvider {
  get redirectUrl(): string {
    return getAppUrl() + "/fe-oauth/callback/debug";
  }

  saveServerMetadata(metadata: OAuthMetadata) {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(metadata));
  }

  getServerMetadata(): OAuthMetadata | null {
    const key = getServerSpecificKey(
      SESSION_KEYS.SERVER_METADATA,
      this.serverUrl,
    );
    const metadata = sessionStorage.getItem(key);
    if (!metadata) {
      return null;
    }
    return JSON.parse(metadata);
  }

  clear() {
    super.clear();
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.SERVER_METADATA, this.serverUrl),
    );
  }
}

// Factory function to create an OAuth provider for a specific MCP server
export function createAuthProvider(
  mcpServerUuid: string,
  serverUrl: string,
): DbOAuthClientProvider {
  return new DbOAuthClientProvider(mcpServerUuid, serverUrl);
}

// Factory function to create a debug OAuth provider for a specific MCP server
export function createDebugAuthProvider(
  mcpServerUuid: string,
  serverUrl: string,
): DebugDbOAuthClientProvider {
  return new DebugDbOAuthClientProvider(mcpServerUuid, serverUrl);
}
