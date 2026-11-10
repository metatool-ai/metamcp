import {
  auth,
  discoverOAuthServerInfo,
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
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

// base64url (RFC 4648 §5) encoding of a byte array. Uses btoa for the
// classic base64 step then trims/replaces to the url-safe variant. Browsers
// only — the SDK's `auth()` calls this from `state()` which runs in the
// browser path; no need for a Node fallback here.
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Google scopes can imply narrower permissions. Keep this aligned with
// Workspace MCP's auth/scopes.py so a broad grant (for example drive or
// gmail.modify) does not trigger a needless consent cycle for its subsets.
const GOOGLE_SCOPE_HIERARCHY: Record<string, string[]> = {
  "https://www.googleapis.com/auth/gmail.modify": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.labels",
  ],
  "https://www.googleapis.com/auth/drive": [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ],
  "https://www.googleapis.com/auth/calendar": [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  "https://www.googleapis.com/auth/documents": [
    "https://www.googleapis.com/auth/documents.readonly",
  ],
  "https://www.googleapis.com/auth/spreadsheets": [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ],
  "https://www.googleapis.com/auth/presentations": [
    "https://www.googleapis.com/auth/presentations.readonly",
  ],
  "https://www.googleapis.com/auth/tasks": [
    "https://www.googleapis.com/auth/tasks.readonly",
  ],
  "https://www.googleapis.com/auth/contacts": [
    "https://www.googleapis.com/auth/contacts.readonly",
  ],
  "https://www.googleapis.com/auth/chat.messages": [
    "https://www.googleapis.com/auth/chat.messages.readonly",
  ],
  "https://www.googleapis.com/auth/chat.spaces": [
    "https://www.googleapis.com/auth/chat.spaces.readonly",
  ],
  "https://www.googleapis.com/auth/forms.body": [
    "https://www.googleapis.com/auth/forms.body.readonly",
  ],
  "https://www.googleapis.com/auth/script.projects": [
    "https://www.googleapis.com/auth/script.projects.readonly",
  ],
  "https://www.googleapis.com/auth/script.deployments": [
    "https://www.googleapis.com/auth/script.deployments.readonly",
  ],
};

function expandGoogleScopes(scopes: string[]): Set<string> {
  const expanded = new Set(scopes);
  for (const [broadScope, narrowerScopes] of Object.entries(
    GOOGLE_SCOPE_HIERARCHY,
  )) {
    if (expanded.has(broadScope)) {
      narrowerScopes.forEach((scope) => expanded.add(scope));
    }
  }
  return expanded;
}

// OAuth client provider that works with a specific MCP server
class DbOAuthClientProvider implements OAuthClientProvider {
  private mcpServerUuid: string;
  protected serverUrl: string;
  private forceAuthorization = false;
  private forceClientRegistration = false;
  private pendingScope?: string;

  constructor(mcpServerUuid: string, serverUrl: string) {
    this.mcpServerUuid = mcpServerUuid;
    this.serverUrl = serverUrl;
    // No sessionStorage access here: the constructor runs during Next.js SSR
    // for the MCP server detail page, where sessionStorage is undefined.
    // The SERVER_URL seed is deferred to ensureServerUrlStored(), called by
    // the OAuth-flow methods below, all of which are invoked client-side.
  }

  // Seeds SESSION_KEYS.SERVER_URL on first invocation in the browser. The
  // OAuth callback page reads this key to recover the upstream serverUrl, so
  // it must be set before redirectToAuthorization sends the user away. Safe
  // to call repeatedly; a no-op on the server.
  private ensureServerUrlStored() {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, this.serverUrl);
    // Scope-upgrade authorization can be the first auth flow for a server.
    // The callback needs both values to route the code exchange to this server.
    sessionStorage.setItem(SESSION_KEYS.MCP_SERVER_UUID, this.mcpServerUuid);
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
    // An upstream MCP authorization server binds allowed scopes to the DCR
    // client record. A scope upgrade must register a new client with the
    // expanded scope set; changing only our cached client metadata is not
    // enough and the upstream will reject /authorize with invalid_scope.
    if (this.forceClientRegistration) return undefined;

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
    this.ensureServerUrlStored();
    const clientInformationToSave = this.pendingScope
      ? ({
          ...clientInformation,
          scope: this.pendingScope,
        } as OAuthClientInformation)
      : clientInformation;

    // Save to session storage during OAuth flow
    const key = getServerSpecificKey(
      SESSION_KEYS.CLIENT_INFORMATION,
      this.serverUrl,
    );
    sessionStorage.setItem(key, JSON.stringify(clientInformationToSave));

    // If server exists, also save to database. A new DCR client ID is issued
    // when scope upgrades require a broader registration. Refresh tokens are
    // bound to the old client, so never carry one across a client-ID change.
    if (await this.serverExists()) {
      try {
        const existing = await vanillaTrpcClient.frontend.oauth.get.query({
          mcp_server_uuid: this.mcpServerUuid,
        });
        const previousClientId =
          existing.success && existing.data?.client_information?.client_id;
        const clientIdChanged =
          typeof previousClientId === "string" &&
          previousClientId !== clientInformationToSave.client_id;
        const previousTokens =
          existing.success && existing.data?.tokens
            ? existing.data.tokens
            : undefined;
        const tokensWithoutOldRefreshToken = (() => {
          if (!clientIdChanged || !previousTokens?.refresh_token) {
            return undefined;
          }
          const tokens = { ...previousTokens };
          delete tokens.refresh_token;
          return tokens;
        })();

        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          client_information: clientInformationToSave,
          ...(tokensWithoutOldRefreshToken && {
            tokens: tokensWithoutOldRefreshToken,
          }),
        });
      } catch (error) {
        console.error("Error saving client information to database:", error);
        throw error;
      }
    }
  }

  async tokens() {
    // During a scope upgrade, hide the old token from the SDK so it starts a
    // fresh authorization-code flow instead of silently refreshing old scopes.
    if (this.forceAuthorization) return undefined;

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

  /**
   * Compare the token's granted scopes with the upstream's current scope
   * catalogue before connecting. Workspace MCP publishes scopes_supported
   * in its path-scoped RFC 9728 protected-resource metadata and in its local
   * authorization-server metadata. Prefer resource metadata; only use the
   * latter fallback when the authorization endpoint is hosted by the MCP
   * server itself, since external AS scope catalogues are not necessarily
   * required scopes.
   *
   * Returns true when the browser was redirected into a new OAuth flow.
   */
  async ensureRequiredScopes(): Promise<boolean> {
    let requiredScopes: string[];

    try {
      const discovery = await discoverOAuthServerInfo(this.serverUrl);
      const authorizationMetadata = discovery.authorizationServerMetadata;
      const authorizationEndpoint =
        authorizationMetadata?.authorization_endpoint;
      const localAuthorizationProxy =
        !!authorizationEndpoint &&
        new URL(authorizationEndpoint).origin ===
          new URL(this.serverUrl).origin;
      const advertisedScopes =
        discovery.resourceMetadata?.scopes_supported ??
        (localAuthorizationProxy
          ? authorizationMetadata?.scopes_supported
          : undefined) ??
        [];

      requiredScopes = [...new Set(advertisedScopes)];
    } catch (error) {
      // Servers without OAuth discovery retain the existing connection path.
      console.warn("Unable to discover upstream OAuth scopes:", error);
      return false;
    }

    if (requiredScopes.length === 0) return false;

    const storedTokens = await this.tokens();
    const grantedScopes = expandGoogleScopes(
      (storedTokens?.scope ?? "").split(" ").filter(Boolean),
    );
    const missingScopes = requiredScopes.filter(
      (scope) => !grantedScopes.has(scope),
    );

    if (missingScopes.length === 0) return false;

    console.info(
      `Upstream OAuth scope upgrade required for ${this.mcpServerUuid}: ` +
        `${missingScopes.length} of ${requiredScopes.length} supported scopes are missing`,
    );

    // Persist the requested scope set before redirecting. Some providers omit
    // `scope` from a token response when it equals the requested scope; the
    // backend uses this value as the standards-compliant fallback on exchange.
    this.pendingScope = requiredScopes.join(" ");
    // Register a fresh upstream OAuth client for the expanded scope set.
    // Keep the previous client record and token until registration succeeds;
    // saveClientInformation atomically replaces the cached record afterward.
    this.forceClientRegistration = true;
    this.forceAuthorization = true;
    this.ensureServerUrlStored();

    try {
      const result = await auth(this, {
        serverUrl: this.serverUrl,
        // The SDK passes this scope to both DCR and /authorize.
        scope: requiredScopes.join(" "),
      });
      return result === "REDIRECT";
    } catch (error) {
      this.forceClientRegistration = false;
      this.forceAuthorization = false;
      this.pendingScope = undefined;
      throw error;
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
    this.ensureServerUrlStored();
    window.location.href = authorizationUrl.href;
  }

  // RFC 6749 §10.12 CSRF defence: generate a per-flow random `state`, persist
  // it server-side (`oauth_sessions.expected_state`), and return it for
  // inclusion in the upstream's /authorize URL. The SDK invokes this once
  // per authorize attempt (see `auth.js` in @modelcontextprotocol/sdk). On
  // the callback path the backend compares the echoed value to the
  // persisted one at `exchangeToken` and clears the column on success.
  //
  // The value never round-trips through sessionStorage because the backend
  // is the source of truth — the frontend only needs to forward what the
  // upstream echoed back, which arrives in the callback URL.
  async state(): Promise<string> {
    // 16 random bytes encoded as base64url → ~22 chars, well over the
    // ~128-bit-entropy bar in RFC 6749 §10.10.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const stateValue = base64UrlEncode(bytes);

    if (await this.serverExists()) {
      try {
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: this.mcpServerUuid,
          expected_state: stateValue,
        });
      } catch (error) {
        // Best-effort. If the upsert fails the upstream redirect still
        // carries `stateValue`, but server-side validation will fall
        // through the back-compat NULL branch — the CSRF check degrades
        // to "skipped" rather than rejecting the flow. That is fail-open
        // for CSRF specifically; PKCE plus `resolveOwnedServerUrl`'s
        // ownership/SSRF guard still cover the practical attack surface.
        // Logged so monitoring can alert on a sustained persistence
        // failure, which would indicate the CSRF layer is silently off.
        console.error("Error persisting expected_state to database:", error);
      }
    }

    return stateValue;
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.ensureServerUrlStored();
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
    this.forceAuthorization = false;
    this.forceClientRegistration = false;
    this.pendingScope = undefined;
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
