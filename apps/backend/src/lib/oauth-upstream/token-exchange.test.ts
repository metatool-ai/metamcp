import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoverAuthorizationServerMetadata,
  exchangeAuthorizationCode,
  isUpstreamUnauthorizedError,
  redactToken,
  refreshAccessToken,
  resolveTokenEndpoint,
  resolveTokenEndpointAuthMethod,
  UpstreamTokenError,
} from "./token-exchange";

type FetchImpl = typeof fetch;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const textResponse = (status: number, body: string): Response =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });

describe("redactToken", () => {
  it("returns <absent> for null/undefined", () => {
    expect(redactToken(undefined)).toBe("<absent>");
    expect(redactToken(null)).toBe("<absent>");
  });
  it("returns <short-redacted> for tokens 6 chars or fewer", () => {
    expect(redactToken("abc")).toBe("<short-redacted>");
    expect(redactToken("123456")).toBe("<short-redacted>");
  });
  it("keeps a short prefix and masks the rest", () => {
    expect(redactToken("00D5g000xyzabcdef")).toBe("00D5g0***");
  });
});

describe("exchangeAuthorizationCode", () => {
  const baseInput = {
    tokenEndpoint: "https://login.salesforce.com/services/oauth2/token",
    code: "AUTH_CODE_FROM_REDIRECT",
    codeVerifier: "VERIFIER_FROM_SESSION",
    redirectUri: "https://metamcp.example.com/fe-oauth/callback",
    clientId: "3MVG9.Salesforce",
    authMethod: "none" as const,
  };

  it("POSTs the expected form-encoded body and persists tokens", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url, init) => {
      expect(String(url)).toBe(baseInput.tokenEndpoint);
      expect(init?.method).toBe("POST");
      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe(baseInput.code);
      expect(body.get("code_verifier")).toBe(baseInput.codeVerifier);
      expect(body.get("redirect_uri")).toBe(baseInput.redirectUri);
      expect(body.get("client_id")).toBe(baseInput.clientId);
      const headers = init?.headers as Headers;
      expect(headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
      return jsonResponse(200, {
        access_token: "AT_xyz",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "RT_abc",
        scope: "api refresh_token",
      });
    });

    const tokens = await exchangeAuthorizationCode({ ...baseInput, fetchImpl });
    expect(tokens.access_token).toBe("AT_xyz");
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.refresh_token).toBe("RT_abc");
    expect(tokens.scope).toBe("api refresh_token");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses HTTP Basic auth for client_secret_basic", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (_url, init) => {
      const headers = init?.headers as Headers;
      const auth = headers.get("Authorization");
      expect(auth).toMatch(/^Basic /);
      // base64("3MVG9.Salesforce:shh") -> M01WRzkuU2FsZXNmb3JjZTpzaGg=
      const decoded = Buffer.from(
        (auth ?? "").replace("Basic ", ""),
        "base64",
      ).toString("utf8");
      expect(decoded).toBe("3MVG9.Salesforce:shh");
      // client_secret must NOT be in the body when using Basic
      const body = init?.body as URLSearchParams;
      expect(body.get("client_secret")).toBeNull();
      return jsonResponse(200, { access_token: "x", token_type: "Bearer" });
    });

    await exchangeAuthorizationCode({
      ...baseInput,
      authMethod: "client_secret_basic",
      clientSecret: "shh",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("puts secret in body for client_secret_post", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (_url, init) => {
      const headers = init?.headers as Headers;
      expect(headers.get("Authorization")).toBeNull();
      const body = init?.body as URLSearchParams;
      expect(body.get("client_id")).toBe(baseInput.clientId);
      expect(body.get("client_secret")).toBe("shh");
      return jsonResponse(200, { access_token: "x", token_type: "Bearer" });
    });

    await exchangeAuthorizationCode({
      ...baseInput,
      authMethod: "client_secret_post",
      clientSecret: "shh",
      fetchImpl,
    });
  });

  it("throws UpstreamTokenError with parsed OAuth error envelope on 400", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "authentication failure",
      }),
    );

    const err = await exchangeAuthorizationCode({
      ...baseInput,
      fetchImpl,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamTokenError);
    expect((err as UpstreamTokenError).status).toBe(400);
    expect((err as UpstreamTokenError).oauthError?.error).toBe("invalid_grant");
    expect((err as UpstreamTokenError).oauthError?.error_description).toBe(
      "authentication failure",
    );
  });

  it("throws UpstreamTokenError on 401 without parseable body", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => textResponse(401, "nope"));
    const err = await exchangeAuthorizationCode({
      ...baseInput,
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamTokenError);
    expect((err as UpstreamTokenError).status).toBe(401);
    expect((err as UpstreamTokenError).oauthError).toBeNull();
  });

  it("rejects 2xx responses missing access_token", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(200, { token_type: "Bearer" }),
    );
    await expect(
      exchangeAuthorizationCode({ ...baseInput, fetchImpl }),
    ).rejects.toThrow(/access_token/);
  });

  it("rejects 2xx responses missing token_type", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(200, { access_token: "x" }),
    );
    await expect(
      exchangeAuthorizationCode({ ...baseInput, fetchImpl }),
    ).rejects.toThrow(/token_type/);
  });

  it("rejects when client_secret_basic is selected without a secret", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(200, { access_token: "x", token_type: "Bearer" }),
    );
    await expect(
      exchangeAuthorizationCode({
        ...baseInput,
        authMethod: "client_secret_basic",
        fetchImpl,
      }),
    ).rejects.toThrow(/client_secret/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("refreshAccessToken", () => {
  it("preserves the original refresh_token when the upstream omits it", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (_url, init) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("RT_original");
      return jsonResponse(200, {
        access_token: "AT_new",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });

    const tokens = await refreshAccessToken({
      tokenEndpoint: "https://example.com/token",
      refreshToken: "RT_original",
      clientId: "client-1",
      authMethod: "none",
      fetchImpl,
    });
    expect(tokens.access_token).toBe("AT_new");
    expect(tokens.refresh_token).toBe("RT_original");
  });

  it("uses the new refresh_token when the upstream rotates it", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(200, {
        access_token: "AT_new",
        token_type: "Bearer",
        refresh_token: "RT_rotated",
      }),
    );

    const tokens = await refreshAccessToken({
      tokenEndpoint: "https://example.com/token",
      refreshToken: "RT_original",
      clientId: "client-1",
      authMethod: "none",
      fetchImpl,
    });
    expect(tokens.refresh_token).toBe("RT_rotated");
  });

  it("surfaces 400 invalid_grant for revoked refresh tokens", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(400, {
        error: "invalid_grant",
        error_description: "Refresh token revoked",
      }),
    );

    const err = await refreshAccessToken({
      tokenEndpoint: "https://example.com/token",
      refreshToken: "RT_revoked",
      clientId: "client-1",
      authMethod: "none",
      fetchImpl,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamTokenError);
    expect((err as UpstreamTokenError).oauthError?.error).toBe("invalid_grant");
  });
});

describe("discoverAuthorizationServerMetadata", () => {
  it("returns the metadata on 2xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url) => {
      expect(String(url)).toBe(
        "https://api.example.com/.well-known/oauth-authorization-server",
      );
      return jsonResponse(200, {
        issuer: "https://api.example.com",
        token_endpoint: "https://api.example.com/oauth/token",
        authorization_endpoint: "https://api.example.com/oauth/authorize",
      });
    });

    const metadata = await discoverAuthorizationServerMetadata(
      "https://api.example.com/mcp",
      fetchImpl,
    );
    expect(metadata?.token_endpoint).toBe(
      "https://api.example.com/oauth/token",
    );
  });

  it("returns null on 404", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => textResponse(404, ""));
    const metadata = await discoverAuthorizationServerMetadata(
      "https://api.example.com/mcp",
      fetchImpl,
    );
    expect(metadata).toBeNull();
  });

  it("returns null when fetch throws (CORS, DNS, ...)", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new Error("network error");
    });
    const metadata = await discoverAuthorizationServerMetadata(
      "https://api.example.com",
      fetchImpl,
    );
    expect(metadata).toBeNull();
  });

  it("THROWS on 2xx with non-JSON body (real upstream bug, not absence)", async () => {
    const fetchImpl = vi.fn<FetchImpl>(
      async () => new Response("<html>not json</html>", { status: 200 }),
    );
    await expect(
      discoverAuthorizationServerMetadata(
        "https://api.example.com/mcp",
        fetchImpl,
      ),
    ).rejects.toThrow(/not JSON|not a JSON/i);
  });

  it("THROWS on 2xx with a JSON primitive (not an object)", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(200, "string"));
    await expect(
      discoverAuthorizationServerMetadata(
        "https://api.example.com/mcp",
        fetchImpl,
      ),
    ).rejects.toThrow(/JSON object/i);
  });
});

describe("resolveTokenEndpoint", () => {
  it("prefers client_information.token_endpoint when set", () => {
    expect(
      resolveTokenEndpoint({
        clientInformation: { token_endpoint: "https://upstream/oauth/token" },
        discovered: { token_endpoint: "https://discovered/token" },
        serverUrl: "https://server/mcp",
      }),
    ).toBe("https://upstream/oauth/token");
  });

  it("falls back to discovered token_endpoint when client_information lacks it", () => {
    expect(
      resolveTokenEndpoint({
        clientInformation: { client_id: "x" },
        discovered: { token_endpoint: "https://discovered/token" },
        serverUrl: "https://server/mcp",
      }),
    ).toBe("https://discovered/token");
  });

  it("falls back to <serverUrl>/token when neither source has an endpoint", () => {
    expect(
      resolveTokenEndpoint({
        clientInformation: null,
        discovered: null,
        serverUrl: "https://server.example.com/mcp",
      }),
    ).toBe("https://server.example.com/token");
  });
});

describe("resolveTokenEndpointAuthMethod", () => {
  beforeEach(() => {});
  afterEach(() => {});

  it("honors explicit client_information.token_endpoint_auth_method", () => {
    expect(
      resolveTokenEndpointAuthMethod({
        clientInformation: {
          token_endpoint_auth_method: "client_secret_post",
        },
        discovered: null,
        hasSecret: true,
      }),
    ).toBe("client_secret_post");
  });

  it("falls back to server-supported when client_information is silent", () => {
    expect(
      resolveTokenEndpointAuthMethod({
        clientInformation: null,
        discovered: {
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        },
        hasSecret: true,
      }),
    ).toBe("client_secret_basic");
  });

  it("falls back to none for public PKCE clients", () => {
    expect(
      resolveTokenEndpointAuthMethod({
        clientInformation: null,
        discovered: null,
        hasSecret: false,
      }),
    ).toBe("none");
  });
});

describe("isUpstreamUnauthorizedError", () => {
  it("recognises errors with name === UnauthorizedError (SDK class)", () => {
    class UnauthorizedError extends Error {
      override name = "UnauthorizedError";
    }
    expect(isUpstreamUnauthorizedError(new UnauthorizedError("nope"))).toBe(
      true,
    );
  });

  it("recognises errors whose message mentions 401 or unauthorized", () => {
    expect(
      isUpstreamUnauthorizedError(new Error("HTTP 401: token expired")),
    ).toBe(true);
    expect(
      isUpstreamUnauthorizedError(new Error("Request was Unauthorized")),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isUpstreamUnauthorizedError(null)).toBe(false);
    expect(isUpstreamUnauthorizedError(undefined)).toBe(false);
    expect(isUpstreamUnauthorizedError(new Error("ECONNREFUSED"))).toBe(false);
    expect(isUpstreamUnauthorizedError("just a string")).toBe(false);
  });

  it("does not false-positive on the word 'authorize' alone", () => {
    expect(
      isUpstreamUnauthorizedError(new Error("authorize endpoint missing")),
    ).toBe(false);
  });

  // Salesforce, Okta, and some Microsoft endpoints return HTTP 403 (not
  // 401) when an access token has expired. The SDK's transport surfaces
  // the response body in the error message, so we can pattern-match the
  // OAuth error envelope. Bare 403s (plain permission denial) must NOT
  // be classified as auth errors — refreshing won't help, and burning a
  // rotating refresh token on it would be a net loss.
  it("classifies HTTP 403 + invalid_token OAuth envelope as auth error", () => {
    expect(
      isUpstreamUnauthorizedError(
        new Error(
          'Error POSTing to endpoint (HTTP 403): {"error":"invalid_token","error_description":"Access token is expired"}',
        ),
      ),
    ).toBe(true);
  });

  it("classifies HTTP 403 + expired_token OAuth envelope as auth error", () => {
    expect(
      isUpstreamUnauthorizedError(
        new Error(
          'Streamable HTTP error: (HTTP 403): {"error": "expired_token"}',
        ),
      ),
    ).toBe(true);
  });

  it("classifies HTTP 403 + insufficient_scope as auth error", () => {
    expect(
      isUpstreamUnauthorizedError(
        new Error(
          'Streamable HTTP error: (HTTP 403): {"error":"insufficient_scope"}',
        ),
      ),
    ).toBe(true);
  });

  it("classifies HTTP 403 + WWW-Authenticate: Bearer hint as auth error", () => {
    expect(
      isUpstreamUnauthorizedError(
        new Error(
          'HTTP 403; headers: { "WWW-Authenticate": "Bearer realm=\\"example\\"" }',
        ),
      ),
    ).toBe(true);
  });

  it("does NOT classify a bare HTTP 403 as auth error (legitimate permission denial)", () => {
    expect(
      isUpstreamUnauthorizedError(
        new Error("Error POSTing to endpoint (HTTP 403): Forbidden"),
      ),
    ).toBe(false);
  });

  it("does NOT classify HTTP 403 + non-token OAuth error (e.g. invalid_client) as auth error", () => {
    expect(
      isUpstreamUnauthorizedError(
        new Error('(HTTP 403): {"error":"invalid_client"}'),
      ),
    ).toBe(false);
  });
});
