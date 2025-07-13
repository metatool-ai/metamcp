import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformation,
  OAuthClientInformationSchema,
  OAuthTokens,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { vanillaTrpcClient } from "./trpc";

// OAuth client provider that works with a specific MCP server
class DbOAuthClientProvider implements OAuthClientProvider {
  private mcpServerUuid: string;
  private storagePrefix: string;

  constructor(mcpServerUuid: string) {
    this.mcpServerUuid = mcpServerUuid;
    this.storagePrefix = `oauth_${this.mcpServerUuid}_`;
  }

  get redirectUrl() {
    // Use window.location.origin for dynamic origin detection
    return window.location.origin + "/oauth/callback";
  }

  get clientMetadata() {
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
        const storedInfo = sessionStorage.getItem(
          `${this.storagePrefix}client_information`,
        );
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
    sessionStorage.setItem(
      `${this.storagePrefix}client_information`,
      JSON.stringify(clientInformation),
    );

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
        const storedTokens = sessionStorage.getItem(
          `${this.storagePrefix}tokens`,
        );
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
    sessionStorage.setItem(
      `${this.storagePrefix}tokens`,
      JSON.stringify(tokens),
    );

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
    sessionStorage.setItem(`${this.storagePrefix}code_verifier`, codeVerifier);

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
    const codeVerifier = sessionStorage.getItem(
      `${this.storagePrefix}code_verifier`,
    );
    if (!codeVerifier) {
      throw new Error("No code verifier saved for session");
    }

    return codeVerifier;
  }

  clear() {
    sessionStorage.removeItem(`${this.storagePrefix}client_information`);
    sessionStorage.removeItem(`${this.storagePrefix}tokens`);
    sessionStorage.removeItem(`${this.storagePrefix}code_verifier`);
  }
}

// Factory function to create an OAuth provider for a specific MCP server
export function createAuthProvider(
  mcpServerUuid: string,
): DbOAuthClientProvider {
  return new DbOAuthClientProvider(mcpServerUuid);
}
