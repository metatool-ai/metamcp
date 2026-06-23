// Server-side OAuth 2.0 authorization-code & refresh-token exchange.
//
// MetaMCP cannot run the token POST from the browser: most enterprise OAuth
// providers (Salesforce, Okta, Auth0, Microsoft Entra, ServiceNow, ...) do
// not set `Access-Control-Allow-Origin: *` on their token endpoints, so the
// fetch succeeds upstream but the browser blocks the response body. This
// module is the server-to-server replacement.
//
// This is *not* a generic CORS proxy. It only knows how to do RFC 6749
// authorization-code and refresh-token grants against a token endpoint that
// is known ahead of time (either from pre-registered client_information or
// from discovery against the protected resource).

import logger from "../../utils/logger";

export type TokenEndpointAuthMethod =
  | "none"
  | "client_secret_basic"
  | "client_secret_post";

export interface OAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
  // Some providers (Salesforce, Microsoft) include additional fields like
  // `id_token`, `instance_url`, `signature`, etc. We keep them via index
  // signature so the jsonb round-trip preserves them.
  [key: string]: unknown;
}

export interface UpstreamOAuthError {
  error: string;
  error_description?: string;
  error_uri?: string;
}

export class UpstreamTokenError extends Error {
  readonly status: number;
  readonly oauthError: UpstreamOAuthError | null;

  constructor(
    status: number,
    oauthError: UpstreamOAuthError | null,
    message?: string,
  ) {
    super(
      message ??
        oauthError?.error_description ??
        oauthError?.error ??
        `Upstream returned HTTP ${status}`,
    );
    this.name = "UpstreamTokenError";
    this.status = status;
    this.oauthError = oauthError;
  }
}

interface PostFormInput {
  tokenEndpoint: string;
  params: URLSearchParams;
  authMethod: TokenEndpointAuthMethod;
  clientId: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}

// Mask a token value for logs. Never log the full token.
export function redactToken(token: string | undefined | null): string {
  if (!token) return "<absent>";
  if (token.length <= 6) return "<short-redacted>";
  return `${token.slice(0, 6)}***`;
}

async function postFormToToken({
  tokenEndpoint,
  params,
  authMethod,
  clientId,
  clientSecret,
  fetchImpl,
}: PostFormInput): Promise<OAuthTokens> {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  });

  if (authMethod === "client_secret_basic") {
    if (!clientSecret) {
      throw new Error("client_secret_basic requires a client_secret");
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers.set("Authorization", `Basic ${basic}`);
  } else if (authMethod === "client_secret_post") {
    if (!clientSecret) {
      throw new Error("client_secret_post requires a client_secret");
    }
    params.set("client_id", clientId);
    params.set("client_secret", clientSecret);
  } else {
    // Public PKCE clients send client_id in the body and omit the secret.
    params.set("client_id", clientId);
  }

  const doFetch = fetchImpl ?? fetch;
  const response = await doFetch(tokenEndpoint, {
    method: "POST",
    headers,
    body: params,
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const oauthError =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as UpstreamOAuthError)
        : null;
    throw new UpstreamTokenError(response.status, oauthError);
  }

  if (!payload || typeof payload !== "object") {
    throw new UpstreamTokenError(
      response.status,
      null,
      "Upstream token endpoint returned a non-JSON 2xx response",
    );
  }
  const tokens = payload as OAuthTokens;
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.token_type !== "string"
  ) {
    throw new UpstreamTokenError(
      response.status,
      null,
      "Upstream token endpoint response missing access_token or token_type",
    );
  }

  return tokens;
}

export interface ExchangeAuthorizationCodeInput {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  authMethod: TokenEndpointAuthMethod;
  fetchImpl?: typeof fetch;
}

export async function exchangeAuthorizationCode(
  input: ExchangeAuthorizationCodeInput,
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
  });

  return postFormToToken({
    tokenEndpoint: input.tokenEndpoint,
    params,
    authMethod: input.authMethod,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl: input.fetchImpl,
  });
}

export interface RefreshAccessTokenInput {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  authMethod: TokenEndpointAuthMethod;
  scope?: string;
  fetchImpl?: typeof fetch;
}

export async function refreshAccessToken(
  input: RefreshAccessTokenInput,
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  if (input.scope) {
    params.set("scope", input.scope);
  }

  const tokens = await postFormToToken({
    tokenEndpoint: input.tokenEndpoint,
    params,
    authMethod: input.authMethod,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl: input.fetchImpl,
  });

  // RFC 6749 §6: refresh response MAY omit refresh_token, in which case the
  // original refresh_token remains valid. Preserve it so we don't lose the
  // ability to refresh again.
  if (!tokens.refresh_token) {
    tokens.refresh_token = input.refreshToken;
  }
  return tokens;
}

export interface OAuthAuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  grant_types_supported?: string[];
}

// Server-side discovery against `/.well-known/oauth-authorization-server`.
// Returns null on any *absence* condition (network error, 4xx/5xx, invalid
// URL) so callers can fall back to client_information or the `/token`
// path. **Throws** on malformed 2xx responses — silently dropping a
// misconfigured provider's metadata would mask real upstream bugs.
export async function discoverAuthorizationServerMetadata(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthAuthorizationServerMetadata | null> {
  let wellKnownUrl: URL;
  try {
    wellKnownUrl = new URL(
      "/.well-known/oauth-authorization-server",
      serverUrl,
    );
  } catch {
    return null;
  }

  let response: Response;
  try {
    response = await fetchImpl(wellKnownUrl, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    logger.warn(
      `OAuth discovery failed at ${wellKnownUrl.href}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
  if (!response.ok) return null;

  // 2xx but malformed: this is a real upstream bug. Throw so the caller's
  // error path (exchangeToken/refreshToken) surfaces it as
  // `discovery_malformed` rather than silently behaving as if discovery
  // wasn't supported.
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      `OAuth discovery at ${wellKnownUrl.href} returned 2xx but body was not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!data || typeof data !== "object") {
    throw new Error(
      `OAuth discovery at ${wellKnownUrl.href} returned 2xx but body was not a JSON object`,
    );
  }
  return data as OAuthAuthorizationServerMetadata;
}

// Determine the token endpoint to POST against. Priority:
//   1. `client_information.token_endpoint` (set by the pre-registered-client
//      UI for providers like Salesforce that publish the endpoint OOB)
//   2. The `token_endpoint` returned by `.well-known` discovery
//   3. Fallback to `<server_url>/token` (matches the MCP SDK's behavior)
export function resolveTokenEndpoint(args: {
  clientInformation: Record<string, unknown> | null | undefined;
  discovered: OAuthAuthorizationServerMetadata | null;
  serverUrl: string;
}): string {
  const ci = args.clientInformation as
    | { token_endpoint?: unknown }
    | null
    | undefined;
  if (typeof ci?.token_endpoint === "string" && ci.token_endpoint.length > 0) {
    return ci.token_endpoint;
  }
  if (
    args.discovered?.token_endpoint &&
    typeof args.discovered.token_endpoint === "string"
  ) {
    return args.discovered.token_endpoint;
  }
  return new URL("/token", args.serverUrl).toString();
}

// Pick the token endpoint auth method, honoring (in order):
//   1. Explicit value on client_information
//   2. Server's declared supported methods (prefer `none` for PKCE, then
//      `client_secret_basic`, then `client_secret_post`)
//   3. `client_secret_basic` if a secret is present, else `none`
// OAuth error envelope codes that indicate an expired/invalid access
// token rather than a permanent permission denial. When the upstream
// returns HTTP 403 with one of these in the body, the access token is
// the problem (so refresh is worth trying), not the user's permissions.
const INVALID_TOKEN_OAUTH_ERROR_CODES = [
  "invalid_token",
  "expired_token",
  "insufficient_scope",
  "invalid_grant",
] as const;

// Best-effort: classify an error from `client.connect(transport)` as a
// case worth attempting a token refresh for.
//
// 401 / `UnauthorizedError` are always classified as auth errors.
//
// 403 is classified as an auth error ONLY when the response body matches
// an OAuth error envelope with one of the codes above, or when the SDK's
// error message surfaces a `WWW-Authenticate: Bearer` hint. A bare 403
// is treated as a legitimate permission denial — refreshing the token
// won't make it go away, and burning a rotating refresh_token on it
// would be worse than no-op.
export function isUpstreamUnauthorizedError(error: unknown): boolean {
  if (!error) return false;
  if (
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: string }).name === "UnauthorizedError"
  ) {
    return true;
  }
  if (!(error instanceof Error)) return false;

  const message = error.message;

  if (/\b401\b|unauthorized/i.test(message)) return true;

  if (/\b403\b/.test(message)) {
    const codes = INVALID_TOKEN_OAUTH_ERROR_CODES.join("|");
    const oauthEnvelope = new RegExp(`"error"\\s*:\\s*"(?:${codes})"`);
    if (oauthEnvelope.test(message)) return true;
    // The SDK error message may serialize the response headers in any
    // shape (raw `WWW-Authenticate: Bearer ...`, JSON-encoded headers
    // object, etc.). Co-occurrence of both tokens is a sufficiently
    // narrow heuristic for "this 403 came back with a Bearer challenge".
    if (/WWW-Authenticate/i.test(message) && /\bBearer\b/.test(message)) {
      return true;
    }
  }

  return false;
}

export function resolveTokenEndpointAuthMethod(args: {
  clientInformation: Record<string, unknown> | null | undefined;
  discovered: OAuthAuthorizationServerMetadata | null;
  hasSecret: boolean;
}): TokenEndpointAuthMethod {
  const declared = (
    args.clientInformation as { token_endpoint_auth_method?: unknown } | null
  )?.token_endpoint_auth_method;
  if (
    declared === "none" ||
    declared === "client_secret_basic" ||
    declared === "client_secret_post"
  ) {
    return declared;
  }
  const supported =
    args.discovered?.token_endpoint_auth_methods_supported ?? [];
  if (args.hasSecret) {
    if (supported.includes("client_secret_basic")) return "client_secret_basic";
    if (supported.includes("client_secret_post")) return "client_secret_post";
    return "client_secret_basic";
  }
  return "none";
}
