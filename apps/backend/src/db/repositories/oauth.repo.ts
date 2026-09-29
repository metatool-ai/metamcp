import {
  OAuthAccessToken,
  OAuthAccessTokenCreateInput,
  OAuthAuthorizationCode,
  OAuthAuthorizationCodeCreateInput,
  OAuthClient,
  OAuthClientCreateInput,
} from "@repo/zod-types";
import { and, eq, isNull, lt } from "drizzle-orm";

import { hashToken } from "../../lib/secrets/token-hash";
import { db } from "../index";
import {
  oauthAccessTokensTable,
  oauthAuthorizationCodesTable,
  oauthClientsTable,
} from "../schema";

/**
 * MetaMCP's OAuth authorization server. Authorization codes, access tokens,
 * refresh tokens and client secrets are stored as SHA-256 digests: methods
 * take the values presented by clients and hash them. Rows read back hold
 * digests (see deleteAccessTokenByHash).
 */
export class OAuthRepository {
  // ===== Registered Clients =====

  async getClient(clientId: string): Promise<OAuthClient | null> {
    const result = await db
      .select()
      .from(oauthClientsTable)
      .where(eq(oauthClientsTable.client_id, clientId))
      .limit(1);
    return result[0] || null;
  }

  /** `client_secret` is the clear-text secret returned to the client once. */
  async upsertClient(clientData: OAuthClientCreateInput): Promise<void> {
    await db
      .insert(oauthClientsTable)
      .values({
        ...clientData,
        client_secret: clientData.client_secret
          ? hashToken(clientData.client_secret)
          : clientData.client_secret,
      })
      .onConflictDoUpdate({
        target: oauthClientsTable.client_id,
        set: {
          redirect_uris: clientData.redirect_uris,
          updated_at: new Date(),
        },
      });
  }

  // ===== Authorization Codes =====

  async getAuthCode(code: string): Promise<OAuthAuthorizationCode | null> {
    const result = await db
      .select()
      .from(oauthAuthorizationCodesTable)
      .where(eq(oauthAuthorizationCodesTable.code, hashToken(code)))
      .limit(1);
    return result[0] || null;
  }

  async setAuthCode(
    code: string,
    data: OAuthAuthorizationCodeCreateInput,
  ): Promise<void> {
    await db.insert(oauthAuthorizationCodesTable).values({
      code: hashToken(code),
      client_id: data.client_id,
      redirect_uri: data.redirect_uri,
      scope: data.scope,
      user_id: data.user_id,
      code_challenge: data.code_challenge,
      code_challenge_method: data.code_challenge_method,
      expires_at: new Date(data.expires_at),
    });
  }

  async deleteAuthCode(code: string): Promise<void> {
    await db
      .delete(oauthAuthorizationCodesTable)
      .where(eq(oauthAuthorizationCodesTable.code, hashToken(code)));
  }

  // ===== Access Tokens =====

  async getAccessToken(token: string): Promise<OAuthAccessToken | null> {
    const result = await db
      .select()
      .from(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.access_token, hashToken(token)))
      .limit(1);
    return result[0] || null;
  }

  /**
   * The stored row of a live MetaMCP access token, or null. An expired access
   * token row is left in place: it also carries the refresh token, which
   * stays usable until its own expiry (rows go in `cleanupExpired`).
   */
  async getActiveAccessToken(token: string): Promise<OAuthAccessToken | null> {
    if (!token.startsWith("mcp_token_")) {
      return null;
    }
    const tokenData = await this.getAccessToken(token);
    if (!tokenData || Date.now() > tokenData.expires_at.getTime()) {
      return null;
    }
    return tokenData;
  }

  async setAccessToken(
    token: string,
    data: OAuthAccessTokenCreateInput & {
      refresh_token?: string;
      refresh_token_expires_at?: number;
    },
  ): Promise<void> {
    await db.insert(oauthAccessTokensTable).values({
      access_token: hashToken(token),
      client_id: data.client_id,
      user_id: data.user_id,
      scope: data.scope,
      expires_at: new Date(data.expires_at),
      refresh_token: data.refresh_token ? hashToken(data.refresh_token) : null,
      refresh_token_expires_at: data.refresh_token_expires_at
        ? new Date(data.refresh_token_expires_at)
        : null,
    });
  }

  async deleteAccessToken(token: string): Promise<void> {
    await this.deleteAccessTokenByHash(hashToken(token));
  }

  /** Deletes a token row read from the database (which holds the digest). */
  async deleteAccessTokenByHash(tokenHash: string): Promise<void> {
    await db
      .delete(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.access_token, tokenHash));
  }

  // ===== Refresh Tokens =====

  async getByRefreshToken(refreshToken: string) {
    const result = await db
      .select()
      .from(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.refresh_token, hashToken(refreshToken)))
      .limit(1);
    return result[0] || null;
  }

  // ===== Cleanup =====

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    await Promise.all([
      db
        .delete(oauthAuthorizationCodesTable)
        .where(lt(oauthAuthorizationCodesTable.expires_at, now)),
      // Delete tokens where both access token AND refresh token are expired
      // (or refresh token is null)
      db
        .delete(oauthAccessTokensTable)
        .where(
          and(
            lt(oauthAccessTokensTable.expires_at, now),
            lt(oauthAccessTokensTable.refresh_token_expires_at, now),
          ),
        ),
      db
        .delete(oauthAccessTokensTable)
        .where(
          and(
            lt(oauthAccessTokensTable.expires_at, now),
            isNull(oauthAccessTokensTable.refresh_token),
          ),
        ),
    ]);
  }
}

export const oauthRepository = new OAuthRepository();
