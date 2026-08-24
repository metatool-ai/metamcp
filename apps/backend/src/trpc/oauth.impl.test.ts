import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vitest hoists vi.mock() to before imports, so the repository mocks fire
// before oauth.impl loads and grabs the real repositories. The mock
// factories return fresh vi.fn() instances we can grab via dynamic import
// inside each test.
//
// `mcpServersRepository.findByUuid` is mocked because exchange/refresh
// resolve the upstream URL from the DB (NOT from the caller) as the SSRF
// guard for the OAuth token-exchange path.
vi.mock("../db/repositories", () => ({
  oauthSessionsRepository: {
    findByMcpServerUuid: vi.fn(),
    upsert: vi.fn(),
    clearExpectedState: vi.fn(),
  },
  mcpServersRepository: {
    findByUuid: vi.fn(),
  },
}));

// Logger writes to stdout otherwise.
vi.mock("../utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORIGINAL_APP_URL = process.env.APP_URL;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("oauthImplementations.exchangeToken", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://metamcp.example.com";
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  const loadModule = async () => {
    const repos = await import("../db/repositories");
    const impl = await import("./oauth.impl");
    return {
      oauthImplementations: impl.oauthImplementations,
      findByMcpServerUuid: repos.oauthSessionsRepository
        .findByMcpServerUuid as ReturnType<typeof vi.fn>,
      upsert: repos.oauthSessionsRepository.upsert as ReturnType<typeof vi.fn>,
      clearExpectedState: repos.oauthSessionsRepository
        .clearExpectedState as ReturnType<typeof vi.fn>,
      findServerByUuid: repos.mcpServersRepository.findByUuid as ReturnType<
        typeof vi.fn
      >,
    };
  };

  // Helper: a server row the resolver will accept (owned, HTTP, valid URL).
  const ownedServer = (uuid: string, url: string, userId = "user-1") => ({
    uuid,
    name: "test-server",
    type: "STREAMABLE_HTTP" as const,
    url,
    user_id: userId,
    description: null,
    command: null,
    args: [] as string[],
    env: {},
    error_status: "NONE" as const,
    created_at: new Date(),
    bearerToken: null,
    headers: {},
  });

  const USER_ID = "user-1";

  const SERVER_UUID = "00000000-0000-0000-0000-000000000abc";

  it("loads the session, POSTs to the upstream token endpoint, and persists the tokens", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      findServerByUuid,
    } = await loadModule();

    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://api.salesforce.com/platform/mcp/v1"),
    );
    findByMcpServerUuid.mockResolvedValue({
      uuid: "sess",
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "PKCE_VERIFIER",
      client_information: {
        client_id: "3MVG9.Salesforce",
        token_endpoint: "https://login.salesforce.com/services/oauth2/token",
      },
      tokens: null,
    });
    upsert.mockResolvedValue({ uuid: "sess" });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString();
        if (urlStr.includes("/.well-known/oauth-authorization-server")) {
          return new Response("not found", { status: 404 });
        }
        expect(urlStr).toBe(
          "https://login.salesforce.com/services/oauth2/token",
        );
        const body = init?.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("authorization_code");
        expect(body.get("code")).toBe("CODE_FROM_REDIRECT");
        expect(body.get("code_verifier")).toBe("PKCE_VERIFIER");
        expect(body.get("redirect_uri")).toBe(
          "https://metamcp.example.com/fe-oauth/callback",
        );
        expect(body.get("client_id")).toBe("3MVG9.Salesforce");
        return jsonResponse(200, {
          access_token: "AT_xyz",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "RT_abc",
        });
      });

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "CODE_FROM_REDIRECT" },
      USER_ID,
    );

    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      mcp_server_uuid: SERVER_UUID,
      tokens: expect.objectContaining({
        access_token: "AT_xyz",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "RT_abc",
      }),
    });
    fetchSpy.mockRestore();
  });

  it("returns the upstream OAuth error envelope on 400 instead of throwing", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      findServerByUuid,
    } = await loadModule();

    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://api.salesforce.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "PKCE_VERIFIER",
      client_information: {
        client_id: "3MVG9",
        token_endpoint: "https://login.salesforce.com/services/oauth2/token",
      },
      tokens: null,
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString();
        if (urlStr.includes("/.well-known/")) {
          return new Response("nope", { status: 404 });
        }
        return jsonResponse(400, {
          error: "invalid_grant",
          error_description: "authentication failure",
        });
      });

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "BAD" },
      USER_ID,
    );

    expect(result).toEqual({
      success: false,
      error: "invalid_grant",
      error_description: "authentication failure",
      upstream_status: 400,
    });
    expect(upsert).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns server_not_found when the MCP server does not exist", async () => {
    const { oauthImplementations, findServerByUuid } = await loadModule();
    findServerByUuid.mockResolvedValue(undefined);
    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C" },
      USER_ID,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("server_not_found");
  });

  it("returns access_denied when a different user owns the server", async () => {
    const { oauthImplementations, findServerByUuid } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://api.example.com/mcp", "other-user"),
    );
    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C" },
      USER_ID,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("access_denied");
  });

  it("returns session_not_found when the OAuth session is missing", async () => {
    const { oauthImplementations, findByMcpServerUuid, findServerByUuid } =
      await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://api.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue(undefined);

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C" },
      USER_ID,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("session_not_found");
  });

  it("returns code_verifier_missing when the session has no PKCE verifier", async () => {
    const { oauthImplementations, findByMcpServerUuid, findServerByUuid } =
      await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://api.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: null,
      client_information: { client_id: "x" },
      tokens: null,
    });

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C" },
      USER_ID,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("code_verifier_missing");
  });

  it("returns client_information_missing when client_id is absent", async () => {
    const { oauthImplementations, findByMcpServerUuid, findServerByUuid } =
      await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://api.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "verifier",
      client_information: {},
      tokens: null,
    });

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C" },
      USER_ID,
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error).toBe("client_information_missing");
  });
});

// Regression test for redirect_uri byte-match. The frontend builds the
// redirect_uri as `getAppUrl() + "/fe-oauth/callback"` with no
// normalization (apps/frontend/lib/oauth-provider.ts), so the backend
// MUST mirror that exactly. Diverging normalization (e.g. stripping the
// trailing slash) silently re-introduces the upstream `invalid_grant`
// failure mode we are fixing.
describe("exchangeToken redirect_uri byte-match", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  const loadModule = async () => {
    const repos = await import("../db/repositories");
    const impl = await import("./oauth.impl");
    return {
      oauthImplementations: impl.oauthImplementations,
      findByMcpServerUuid: repos.oauthSessionsRepository
        .findByMcpServerUuid as ReturnType<typeof vi.fn>,
      upsert: repos.oauthSessionsRepository.upsert as ReturnType<typeof vi.fn>,
      clearExpectedState: repos.oauthSessionsRepository
        .clearExpectedState as ReturnType<typeof vi.fn>,
      findServerByUuid: repos.mcpServersRepository.findByUuid as ReturnType<
        typeof vi.fn
      >,
    };
  };

  // Helper: a server row the resolver will accept (owned, HTTP, valid URL).
  const ownedServer = (uuid: string, url: string, userId = "user-1") => ({
    uuid,
    name: "test-server",
    type: "STREAMABLE_HTTP" as const,
    url,
    user_id: userId,
    description: null,
    command: null,
    args: [] as string[],
    env: {},
    error_status: "NONE" as const,
    created_at: new Date(),
    bearerToken: null,
    headers: {},
  });

  const USER_ID = "user-1";

  it.each([
    [
      "no trailing slash",
      "https://metamcp.example.com",
      "https://metamcp.example.com/fe-oauth/callback",
    ],
    [
      "trailing slash preserved (matches frontend's verbatim concatenation)",
      "https://metamcp.example.com/",
      "https://metamcp.example.com//fe-oauth/callback",
    ],
  ])("uses APP_URL+%s verbatim", async (_label, appUrl, expectedRedirect) => {
    process.env.APP_URL = appUrl;

    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      findServerByUuid,
    } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(
        "00000000-0000-0000-0000-000000000fff",
        "https://upstream/mcp",
      ),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: "00000000-0000-0000-0000-000000000fff",
      code_verifier: "v",
      client_information: {
        client_id: "c",
        token_endpoint: "https://upstream/token",
      },
      tokens: null,
    });
    upsert.mockResolvedValue({});

    let observedRedirect: string | null = null;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString();
        if (urlStr.includes("/.well-known/")) {
          return new Response("nope", { status: 404 });
        }
        const body = init?.body as URLSearchParams;
        observedRedirect = body.get("redirect_uri");
        return new Response(
          JSON.stringify({ access_token: "x", token_type: "Bearer" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

    await oauthImplementations.exchangeToken(
      {
        mcp_server_uuid: "00000000-0000-0000-0000-000000000fff",
        code: "C",
      },
      USER_ID,
    );

    expect(observedRedirect).toBe(expectedRedirect);
    fetchSpy.mockRestore();
  });
});

describe("oauthImplementations.refreshToken", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://metamcp.example.com";
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  const loadModule = async () => {
    const repos = await import("../db/repositories");
    const impl = await import("./oauth.impl");
    return {
      oauthImplementations: impl.oauthImplementations,
      findByMcpServerUuid: repos.oauthSessionsRepository
        .findByMcpServerUuid as ReturnType<typeof vi.fn>,
      upsert: repos.oauthSessionsRepository.upsert as ReturnType<typeof vi.fn>,
      clearExpectedState: repos.oauthSessionsRepository
        .clearExpectedState as ReturnType<typeof vi.fn>,
      findServerByUuid: repos.mcpServersRepository.findByUuid as ReturnType<
        typeof vi.fn
      >,
    };
  };

  // Helper: a server row the resolver will accept (owned, HTTP, valid URL).
  const ownedServer = (uuid: string, url: string, userId = "user-1") => ({
    uuid,
    name: "test-server",
    type: "STREAMABLE_HTTP" as const,
    url,
    user_id: userId,
    description: null,
    command: null,
    args: [] as string[],
    env: {},
    error_status: "NONE" as const,
    created_at: new Date(),
    bearerToken: null,
    headers: {},
  });

  const USER_ID = "user-1";

  const SERVER_UUID = "00000000-0000-0000-0000-000000000def";

  it("POSTs grant_type=refresh_token and persists the new access token", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      findServerByUuid,
    } = await loadModule();

    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: null,
      client_information: {
        client_id: "client-1",
        token_endpoint: "https://example.com/token",
      },
      tokens: {
        access_token: "OLD",
        token_type: "Bearer",
        refresh_token: "RT_original",
      },
    });
    upsert.mockResolvedValue({});

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString();
        if (urlStr.includes("/.well-known/")) {
          return new Response("nope", { status: 404 });
        }
        const body = init?.body as URLSearchParams;
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("RT_original");
        return jsonResponse(200, {
          access_token: "AT_new",
          token_type: "Bearer",
        });
      });

    const result = await oauthImplementations.refreshToken(
      { mcp_server_uuid: SERVER_UUID },
      USER_ID,
    );

    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledWith({
      mcp_server_uuid: SERVER_UUID,
      tokens: expect.objectContaining({
        access_token: "AT_new",
        refresh_token: "RT_original",
      }),
    });
    fetchSpy.mockRestore();
  });

  it("returns no_refresh_token when the session has no refresh_token", async () => {
    const { oauthImplementations, findByMcpServerUuid, findServerByUuid } =
      await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      client_information: { client_id: "x" },
      tokens: { access_token: "x", token_type: "Bearer" },
    });

    const result = await oauthImplementations.refreshToken(
      { mcp_server_uuid: SERVER_UUID },
      USER_ID,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("no_refresh_token");
  });
});

// RFC 6749 §10.12 state CSRF defence. The schema accepted `state` and the
// callback forwarded it, but PR #295 never compared it to a persisted
// value. These tests pin the validation behaviour added in #299:
//   - expected_state truthy → must match input.state (and missing input.state
//     is treated as a mismatch, NOT a bypass)
//   - expected_state null/undefined → back-compat for in-flight pre-fix
//     flows; the exchange proceeds without state validation
//   - one-shot: on a successful exchange, expected_state is cleared so a
//     replay cannot reuse the same code+state pair
//   - on upstream error, expected_state is preserved so the user can retry
//     the exchange without re-running authorize
describe("exchangeToken state CSRF validation", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://metamcp.example.com";
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  const loadModule = async () => {
    const repos = await import("../db/repositories");
    const impl = await import("./oauth.impl");
    return {
      oauthImplementations: impl.oauthImplementations,
      findByMcpServerUuid: repos.oauthSessionsRepository
        .findByMcpServerUuid as ReturnType<typeof vi.fn>,
      upsert: repos.oauthSessionsRepository.upsert as ReturnType<typeof vi.fn>,
      clearExpectedState: repos.oauthSessionsRepository
        .clearExpectedState as ReturnType<typeof vi.fn>,
      findServerByUuid: repos.mcpServersRepository.findByUuid as ReturnType<
        typeof vi.fn
      >,
    };
  };

  const ownedServer = (uuid: string, url: string) => ({
    uuid,
    name: "test-server",
    type: "STREAMABLE_HTTP" as const,
    url,
    user_id: "user-1",
    description: null,
    command: null,
    args: [] as string[],
    env: {},
    error_status: "NONE" as const,
    created_at: new Date(),
    bearerToken: null,
    headers: {},
  });

  const SERVER_UUID = "00000000-0000-0000-0000-0000000000aa";
  const USER_ID = "user-1";

  const upstreamSuccess = vi.fn(async (url: string, init?: RequestInit) => {
    const urlStr = url;
    if (urlStr.includes("/.well-known/")) {
      return new Response("nope", { status: 404 });
    }
    void init;
    return new Response(
      JSON.stringify({
        access_token: "AT",
        token_type: "Bearer",
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  it("expected_state null in DB → exchange proceeds (back-compat for in-flight pre-fix flows)", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      clearExpectedState,
      findServerByUuid,
    } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://upstream.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      uuid: "sess",
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "v",
      client_information: {
        client_id: "c",
        token_endpoint: "https://upstream.example.com/token",
      },
      tokens: null,
      expected_state: null,
    });
    upsert.mockResolvedValue({});
    clearExpectedState.mockResolvedValue({});

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(upstreamSuccess as unknown as typeof fetch);

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C", state: "from-upstream" },
      USER_ID,
    );

    expect(result.success).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    // Clear still runs to belt-and-braces against a future authorize seeding
    // expected_state on this row.
    expect(clearExpectedState).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("expected_state matches input.state → exchange proceeds, clearExpectedState called once", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      clearExpectedState,
      findServerByUuid,
    } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://upstream.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "v",
      client_information: {
        client_id: "c",
        token_endpoint: "https://upstream.example.com/token",
      },
      tokens: null,
      expected_state: "the-nonce",
    });
    upsert.mockResolvedValue({});
    clearExpectedState.mockResolvedValue({});

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(upstreamSuccess as unknown as typeof fetch);

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C", state: "the-nonce" },
      USER_ID,
    );

    expect(result.success).toBe(true);
    expect(clearExpectedState).toHaveBeenCalledWith(SERVER_UUID);
    expect(clearExpectedState).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it("expected_state mismatches input.state → returns invalid_state, no upstream POST, no clear", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      clearExpectedState,
      findServerByUuid,
    } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://upstream.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "v",
      client_information: { client_id: "c" },
      tokens: null,
      expected_state: "the-nonce",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C", state: "different-value" },
      USER_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("invalid_state");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(clearExpectedState).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("expected_state present but input.state missing → returns invalid_state (does not bypass)", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      clearExpectedState,
      findServerByUuid,
    } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://upstream.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "v",
      client_information: { client_id: "c" },
      tokens: null,
      expected_state: "the-nonce",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C" }, // no state
      USER_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("invalid_state");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(clearExpectedState).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("expected_state matches but upstream returns OAuth error → expected_state preserved for retry", async () => {
    const {
      oauthImplementations,
      findByMcpServerUuid,
      upsert,
      clearExpectedState,
      findServerByUuid,
    } = await loadModule();
    findServerByUuid.mockResolvedValue(
      ownedServer(SERVER_UUID, "https://upstream.example.com/mcp"),
    );
    findByMcpServerUuid.mockResolvedValue({
      mcp_server_uuid: SERVER_UUID,
      code_verifier: "v",
      client_information: {
        client_id: "c",
        token_endpoint: "https://upstream.example.com/token",
      },
      tokens: null,
      expected_state: "the-nonce",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        const urlStr = typeof url === "string" ? url : (url as URL).toString();
        if (urlStr.includes("/.well-known/")) {
          return new Response("nope", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "the code was already used",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      });

    const result = await oauthImplementations.exchangeToken(
      { mcp_server_uuid: SERVER_UUID, code: "C", state: "the-nonce" },
      USER_ID,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("invalid_grant");
    }
    expect(upsert).not.toHaveBeenCalled();
    // Crucial: on upstream error the state nonce is NOT cleared so the user
    // can retry the exchange without re-running the authorize flow.
    expect(clearExpectedState).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // Regression test for the persistence bug found in code review: the
  // tRPC `upsert` handler previously stripped `expected_state` before
  // calling the repo, leaving the DB column NULL and silently disabling
  // the CSRF check at `exchangeToken` (which then falls through the
  // back-compat NULL branch). Pins the forward-through behaviour so a
  // future refactor of the spread cannot regress it.
  it("frontend.oauth.upsert forwards expected_state to the repository", async () => {
    const { oauthImplementations, upsert } = await loadModule();
    upsert.mockResolvedValue({
      uuid: "sess",
      mcp_server_uuid: SERVER_UUID,
      client_information: null,
      tokens: null,
      code_verifier: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await oauthImplementations.upsert({
      mcp_server_uuid: SERVER_UUID,
      expected_state: "the-csrf-nonce",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        mcp_server_uuid: SERVER_UUID,
        expected_state: "the-csrf-nonce",
      }),
    );
  });
});
