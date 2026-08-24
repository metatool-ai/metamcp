import {
  OAuthClientInfoRequestSchema,
  OAuthClientInformationSchema,
} from "@repo/zod-types";
import { describe, expect, it } from "vitest";

describe("OAuthClientInfoRequestSchema", () => {
  it("accepts an entirely empty payload (the section was untouched)", () => {
    expect(OAuthClientInfoRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects payload missing client_id when any other field is set", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      client_secret: "shh",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("client_id");
    }
  });

  it("rejects payload missing client_id when authorization_endpoint is set", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      authorization_endpoint: "https://example.com/authorize",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal pre-registered client", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      client_id: "3MVG9",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid authorization_endpoint URL", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      client_id: "3MVG9",
      authorization_endpoint: "not a url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid token_endpoint URL", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      client_id: "3MVG9",
      token_endpoint: "definitely-not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown token_endpoint_auth_method values", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      client_id: "3MVG9",
      token_endpoint_auth_method: "private_key_jwt",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the full RFC 7591 shape we collect from the UI", () => {
    const result = OAuthClientInfoRequestSchema.safeParse({
      client_id: "3MVG9",
      client_secret: "shh",
      scope: "api refresh_token",
      authorization_endpoint:
        "https://login.salesforce.com/services/oauth2/authorize",
      token_endpoint: "https://login.salesforce.com/services/oauth2/token",
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(result.success).toBe(true);
  });
});

describe("OAuthClientInformationSchema", () => {
  // The schema is the read-side validator on the tRPC oauth.get output.
  // Without passthrough, zod's default strip mode silently drops the extra
  // RFC 7591 fields, causing the edit form to lose values on round-trip.
  it("round-trips the extra RFC 7591 fields needed by the pre-registered UI", () => {
    const payload = {
      client_id: "3MVG9.Salesforce",
      client_secret: "shh",
      redirect_uris: ["https://metamcp.example.com/fe-oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "api refresh_token",
      authorization_endpoint:
        "https://login.salesforce.com/services/oauth2/authorize",
      token_endpoint: "https://login.salesforce.com/services/oauth2/token",
    };

    const parsed = OAuthClientInformationSchema.parse(payload);
    expect(parsed).toEqual(payload);
  });
});

// Cross-cut: the value the frontend's `provider.clientInformation()` reads
// from `oauth.get` is parsed by the MCP SDK's own
// `OAuthClientInformationSchema` (apps/frontend/lib/oauth-provider.ts:68).
// PR A added `.passthrough()` to the zod-types schema; this test asserts
// that the resulting object also satisfies the SDK schema. If the SDK ever
// adds new required fields, this test breaks loudly instead of breaking
// the OAuth flow silently in production.
describe("SDK OAuthClientInformationSchema cross-cut", () => {
  it("accepts the shape that the backend writes to oauth_sessions.client_information", async () => {
    const { OAuthClientInformationSchema: SdkSchema } =
      await import("@modelcontextprotocol/sdk/shared/auth.js");

    // Minimum shape MetaMCP persists for a pre-registered client.
    const persisted = {
      client_id: "3MVG9.Salesforce",
      client_secret: "shh",
      redirect_uris: ["https://metamcp.example.com/fe-oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "api refresh_token",
      authorization_endpoint: "https://login.salesforce.com/oauth2/authorize",
      token_endpoint: "https://login.salesforce.com/oauth2/token",
    };

    const parsed = await SdkSchema.parseAsync(persisted);
    // SDK schema only declares the 4 client-id fields; the rest are
    // stripped (it does NOT use .passthrough()). That is OK: the SDK only
    // needs client_id/client_secret to skip dynamic registration; the
    // server-side token exchange reads the rest directly from the DB row.
    expect(parsed.client_id).toBe("3MVG9.Salesforce");
    expect(parsed.client_secret).toBe("shh");
  });
});
