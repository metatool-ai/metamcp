import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthSessionsRepository = {
  findByMcpServerUuid: vi.fn(),
  upsert: vi.fn(),
  clearByMcpServerUuid: vi.fn(),
};

const discoverOAuthProtectedResourceMetadata = vi.fn();
const discoverOAuthMetadata = vi.fn();
const selectResourceURL = vi.fn();
const refreshAuthorization = vi.fn();

vi.mock("../../db/repositories/oauth-sessions.repo", () => ({
  oauthSessionsRepository,
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  discoverOAuthProtectedResourceMetadata,
  discoverOAuthMetadata,
  selectResourceURL,
  refreshAuthorization,
}));

const { clearOAuthTokensOnAuthFailure, getUsableOAuthTokens } = await import(
  "./remote-oauth.service"
);

describe("remote OAuth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes expiring tokens with protected resource metadata", async () => {
    const updatedAt = new Date("2026-05-12T18:00:00.000Z");
    oauthSessionsRepository.findByMcpServerUuid.mockResolvedValue({
      client_information: { client_id: "client-1" },
      tokens: {
        access_token: "old-token",
        token_type: "Bearer",
        refresh_token: "refresh-token",
        expires_in: 3600,
      },
      token_expires_at: new Date(Date.now() - 1000),
      tokens_obtained_at: updatedAt,
      updated_at: updatedAt,
    });
    discoverOAuthProtectedResourceMetadata.mockResolvedValue({
      resource: "https://mcp.kosik.cz/mcp",
      authorization_servers: ["https://mcp.kosik.cz/mcp"],
    });
    selectResourceURL.mockResolvedValue(new URL("https://mcp.kosik.cz/mcp"));
    discoverOAuthMetadata.mockResolvedValue({
      issuer: "https://mcp.kosik.cz/mcp",
      token_endpoint: "https://mcp.kosik.cz/mcp/token",
      authorization_endpoint: "https://mcp.kosik.cz/mcp/authorize",
      response_types_supported: ["code"],
    });
    refreshAuthorization.mockResolvedValue({
      access_token: "new-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
      expires_in: 3600,
    });

    const tokens = await getUsableOAuthTokens(
      "server-1",
      "https://mcp.kosik.cz/mcp/",
    );

    expect(tokens?.access_token).toBe("new-token");
    expect(refreshAuthorization).toHaveBeenCalledWith(
      "https://mcp.kosik.cz/mcp",
      expect.objectContaining({
        clientInformation: { client_id: "client-1" },
        refreshToken: "refresh-token",
        resource: new URL("https://mcp.kosik.cz/mcp"),
      }),
    );
    expect(oauthSessionsRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        mcp_server_uuid: "server-1",
        code_verifier: null,
        tokens: expect.objectContaining({ access_token: "new-token" }),
        token_expires_at: expect.any(Date),
        tokens_obtained_at: expect.any(Date),
      }),
    );
  });

  it("clears invalid refresh credentials", async () => {
    oauthSessionsRepository.findByMcpServerUuid.mockResolvedValue({
      client_information: { client_id: "client-1" },
      tokens: {
        access_token: "old-token",
        token_type: "Bearer",
        refresh_token: "refresh-token",
        expires_in: 3600,
      },
      token_expires_at: new Date(Date.now() - 1000),
      tokens_obtained_at: new Date(),
      updated_at: new Date(),
    });
    discoverOAuthProtectedResourceMetadata.mockResolvedValue({
      resource: "https://mcp.kosik.cz/mcp",
    });
    selectResourceURL.mockResolvedValue(new URL("https://mcp.kosik.cz/mcp"));
    discoverOAuthMetadata.mockResolvedValue(undefined);
    refreshAuthorization.mockRejectedValue(new Error("invalid_grant"));

    const tokens = await getUsableOAuthTokens(
      "server-1",
      "https://mcp.kosik.cz/mcp/",
    );

    expect(tokens).toBeNull();
    expect(oauthSessionsRepository.clearByMcpServerUuid).toHaveBeenCalledWith(
      "server-1",
      "tokens",
    );
  });

  it("does not return an expired token when refresh fails without invalidating credentials", async () => {
    oauthSessionsRepository.findByMcpServerUuid.mockResolvedValue({
      client_information: { client_id: "client-1" },
      tokens: {
        access_token: "expired-token",
        token_type: "Bearer",
        refresh_token: "refresh-token",
        expires_in: 3600,
      },
      token_expires_at: new Date(Date.now() - 1000),
      tokens_obtained_at: new Date(Date.now() - 3_600_000),
      updated_at: new Date(Date.now() - 3_600_000),
    });
    discoverOAuthProtectedResourceMetadata.mockResolvedValue({
      resource: "https://mcp.kosik.cz/mcp",
    });
    selectResourceURL.mockResolvedValue(new URL("https://mcp.kosik.cz/mcp"));
    discoverOAuthMetadata.mockResolvedValue(undefined);
    refreshAuthorization.mockRejectedValue(new Error("network timeout"));

    const tokens = await getUsableOAuthTokens(
      "server-1",
      "https://mcp.kosik.cz/mcp/",
    );

    expect(tokens).toBeNull();
    expect(oauthSessionsRepository.clearByMcpServerUuid).not.toHaveBeenCalled();
  });

  it("does not return an expired token that cannot be refreshed", async () => {
    oauthSessionsRepository.findByMcpServerUuid.mockResolvedValue({
      client_information: { client_id: "client-1" },
      tokens: {
        access_token: "expired-token",
        token_type: "Bearer",
        expires_in: 3600,
      },
      token_expires_at: new Date(Date.now() - 1000),
      tokens_obtained_at: new Date(Date.now() - 3_600_000),
      updated_at: new Date(Date.now() - 3_600_000),
    });

    const tokens = await getUsableOAuthTokens(
      "server-1",
      "https://mcp.kosik.cz/mcp/",
    );

    expect(tokens).toBeNull();
    expect(refreshAuthorization).not.toHaveBeenCalled();
  });

  it("reports whether upstream auth failure cleared stored tokens", async () => {
    await expect(
      clearOAuthTokensOnAuthFailure("server-1", new Error("invalid_token")),
    ).resolves.toBe(true);
    expect(oauthSessionsRepository.clearByMcpServerUuid).toHaveBeenCalledWith(
      "server-1",
      "tokens",
    );

    vi.clearAllMocks();

    await expect(
      clearOAuthTokensOnAuthFailure("server-1", new Error("network timeout")),
    ).resolves.toBe(false);
    expect(oauthSessionsRepository.clearByMcpServerUuid).not.toHaveBeenCalled();
  });
});
