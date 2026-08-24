import {
  OAuthAccessToken,
  OAuthAccessTokenCreateInput,
  OAuthAuthorizationCode,
  OAuthAuthorizationCodeCreateInput,
  OAuthClient,
  OAuthClientCreateInput,
} from "@repo/zod-types";
import { and, eq, isNull, lt } from "drizzle-orm";

import { db } from "../index";
import {
  oauthAccessTokensTable,
  oauthAuthorizationCodesTable,
  oauthClientsTable,
} from "../schema";

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

  async upsertClient(clientData: OAuthClientCreateInput): Promise<void> {
    await db
      .insert(oauthClientsTable)
      .values(clientData)
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
      .where(eq(oauthAuthorizationCodesTable.code, code))
      .limit(1);
    return result[0] || null;
  }

  async setAuthCode(
    code: string,
    data: OAuthAuthorizationCodeCreateInput,
  ): Promise<void> {
    await db.insert(oauthAuthorizationCodesTable).values({
      code,
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
      .where(eq(oauthAuthorizationCodesTable.code, code));
  }

  // ===== Access Tokens =====

  async getAccessToken(token: string): Promise<OAuthAccessToken | null> {
    const result = await db
      .select()
      .from(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.access_token, token))
      .limit(1);
    return result[0] || null;
  }

  async setAccessToken(
    token: string,
    data: OAuthAccessTokenCreateInput & {
      refresh_token?: string;
      refresh_token_expires_at?: number;
    },
  ): Promise<void> {
    await db.insert(oauthAccessTokensTable).values({
      access_token: token,
      client_id: data.client_id,
      user_id: data.user_id,
      scope: data.scope,
      expires_at: new Date(data.expires_at),
      refresh_token: data.refresh_token ?? null,
      refresh_token_expires_at: data.refresh_token_expires_at
        ? new Date(data.refresh_token_expires_at)
        : null,
    });
  }

  async deleteAccessToken(token: string): Promise<void> {
    await db
      .delete(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.access_token, token));
  }

  // ===== Refresh Tokens =====

  async getByRefreshToken(refreshToken: string) {
    const result = await db
      .select()
      .from(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.refresh_token, refreshToken))
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
