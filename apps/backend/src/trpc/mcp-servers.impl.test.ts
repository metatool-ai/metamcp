import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OAuthSessionsRepository } from "../db/repositories/oauth-sessions.repo";
import {
  buildPreRegisteredClientInformation,
  persistPreRegisteredOAuthClient,
  resolveRedirectUri,
} from "./pre-registered-oauth";

const REDIRECT_URI = "https://metamcp.example.com/fe-oauth/callback";

describe("buildPreRegisteredClientInformation", () => {
  it("returns null when client_id is missing", () => {
    expect(
      buildPreRegisteredClientInformation(
        {
          client_secret: "secret",
          scope: "api",
          authorization_endpoint: "https://example.com/authorize",
        },
        REDIRECT_URI,
      ),
    ).toBeNull();
  });

  it("returns null when client_id is whitespace-only", () => {
    expect(
      buildPreRegisteredClientInformation({ client_id: "   " }, REDIRECT_URI),
    ).toBeNull();
  });

  it("builds a minimal public client when only client_id is provided", () => {
    const result = buildPreRegisteredClientInformation(
      { client_id: "3MVG9.Salesforce" },
      REDIRECT_URI,
    );

    expect(result).toEqual({
      client_id: "3MVG9.Salesforce",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("includes the secret, endpoints, and scope when supplied", () => {
    const result = buildPreRegisteredClientInformation(
      {
        client_id: "3MVG9.Salesforce",
        client_secret: "shhh",
        scope: "api refresh_token",
        authorization_endpoint:
          "https://login.salesforce.com/services/oauth2/authorize",
        token_endpoint: "https://login.salesforce.com/services/oauth2/token",
        token_endpoint_auth_method: "client_secret_post",
      },
      REDIRECT_URI,
    );

    expect(result).toEqual({
      client_id: "3MVG9.Salesforce",
      client_secret: "shhh",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "api refresh_token",
      authorization_endpoint:
        "https://login.salesforce.com/services/oauth2/authorize",
      token_endpoint: "https://login.salesforce.com/services/oauth2/token",
    });
  });

  it("trims whitespace from inputs", () => {
    const result = buildPreRegisteredClientInformation(
      {
        client_id: "  trimmed-id  ",
        scope: "  api  ",
        authorization_endpoint: "  https://example.com/authorize  ",
        token_endpoint: "  https://example.com/token  ",
      },
      REDIRECT_URI,
    );

    expect(result).toMatchObject({
      client_id: "trimmed-id",
      scope: "api",
      authorization_endpoint: "https://example.com/authorize",
      token_endpoint: "https://example.com/token",
    });
  });

  it("never reflects the user's redirect_uri input — it is always MetaMCP's callback", () => {
    const result = buildPreRegisteredClientInformation(
      {
        client_id: "3MVG9.Salesforce",
      },
      "https://different.metamcp.example.com/fe-oauth/callback",
    );

    expect(result?.redirect_uris).toEqual([
      "https://different.metamcp.example.com/fe-oauth/callback",
    ]);
  });

  it("omits client_secret when blank", () => {
    const result = buildPreRegisteredClientInformation(
      { client_id: "3MVG9", client_secret: "" },
      REDIRECT_URI,
    );

    expect(result).not.toHaveProperty("client_secret");
  });
});

describe("resolveRedirectUri", () => {
  const original = process.env.APP_URL;
  afterEach(() => {
    process.env.APP_URL = original;
  });

  it("composes APP_URL + /fe-oauth/callback", () => {
    process.env.APP_URL = "https://metamcp.example.com";
    expect(resolveRedirectUri()).toBe(
      "https://metamcp.example.com/fe-oauth/callback",
    );
  });

  it("strips a trailing slash from APP_URL", () => {
    process.env.APP_URL = "https://metamcp.example.com/";
    expect(resolveRedirectUri()).toBe(
      "https://metamcp.example.com/fe-oauth/callback",
    );
  });

  it("throws when APP_URL is not set", () => {
    delete process.env.APP_URL;
    expect(() => resolveRedirectUri()).toThrow(/APP_URL/);
  });
});

describe("persistPreRegisteredOAuthClient", () => {
  const SERVER_UUID = "00000000-0000-0000-0000-000000000001";
  const mockRepo = {
    findByMcpServerUuid: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    deleteByMcpServerUuid: vi.fn(),
  } as unknown as OAuthSessionsRepository & {
    findByMcpServerUuid: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteByMcpServerUuid: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    process.env.APP_URL = "https://metamcp.example.com";
    vi.clearAllMocks();
  });

  it("upserts oauth_sessions.client_information with the server-derived redirect_uri", async () => {
    await persistPreRegisteredOAuthClient(
      SERVER_UUID,
      {
        client_id: "3MVG9",
        client_secret: "shh",
        scope: "api refresh_token",
        authorization_endpoint: "https://login.salesforce.com/oauth2/authorize",
        token_endpoint: "https://login.salesforce.com/oauth2/token",
        token_endpoint_auth_method: "client_secret_post",
      },
      mockRepo,
    );

    expect(mockRepo.upsert).toHaveBeenCalledTimes(1);
    expect(mockRepo.upsert).toHaveBeenCalledWith({
      mcp_server_uuid: SERVER_UUID,
      client_information: expect.objectContaining({
        client_id: "3MVG9",
        client_secret: "shh",
        redirect_uris: ["https://metamcp.example.com/fe-oauth/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        scope: "api refresh_token",
        authorization_endpoint: "https://login.salesforce.com/oauth2/authorize",
        token_endpoint: "https://login.salesforce.com/oauth2/token",
      }),
    });
  });

  it("does not write to the repo when client_id is blank and no prior session exists", async () => {
    (
      mockRepo.findByMcpServerUuid as ReturnType<typeof vi.fn>
    ).mockResolvedValue(undefined);

    await persistPreRegisteredOAuthClient(
      SERVER_UUID,
      { client_id: "" },
      mockRepo,
    );

    expect(mockRepo.findByMcpServerUuid).toHaveBeenCalledWith(SERVER_UUID);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
    expect(mockRepo.deleteByMcpServerUuid).not.toHaveBeenCalled();
  });

  it("deletes the prior oauth_sessions row when the user clears the section", async () => {
    (
      mockRepo.findByMcpServerUuid as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      uuid: "session-uuid",
      mcp_server_uuid: SERVER_UUID,
    });

    await persistPreRegisteredOAuthClient(
      SERVER_UUID,
      { client_id: "" },
      mockRepo,
    );

    expect(mockRepo.deleteByMcpServerUuid).toHaveBeenCalledWith(SERVER_UUID);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });
});
