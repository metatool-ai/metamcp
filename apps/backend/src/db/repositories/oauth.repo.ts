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
  usersTable,
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
          user_id: clientData.user_id,
          updated_at: new Date(),
        },
      });
  }

  async getAllClients(): Promise<OAuthClient[]> {
    const result = await db
      .select({
        client_id: oauthClientsTable.client_id,
        client_secret: oauthClientsTable.client_secret,
        client_name: oauthClientsTable.client_name,
        email: usersTable.email, // Get email from users table
        user_id: oauthClientsTable.user_id,
        redirect_uris: oauthClientsTable.redirect_uris,
        grant_types: oauthClientsTable.grant_types,
        response_types: oauthClientsTable.response_types,
        token_endpoint_auth_method: oauthClientsTable.token_endpoint_auth_method,
        scope: oauthClientsTable.scope,
        can_access_admin: oauthClientsTable.can_access_admin,
        client_uri: oauthClientsTable.client_uri,
        logo_uri: oauthClientsTable.logo_uri,
        contacts: oauthClientsTable.contacts,
        tos_uri: oauthClientsTable.tos_uri,
        policy_uri: oauthClientsTable.policy_uri,
        software_id: oauthClientsTable.software_id,
        software_version: oauthClientsTable.software_version,
        created_at: oauthClientsTable.created_at,
        updated_at: oauthClientsTable.updated_at,
      })
      .from(oauthClientsTable)
      .leftJoin(usersTable, eq(oauthClientsTable.user_id, usersTable.id));
    return result as OAuthClient[];
  }

  async getClientsByUserId(userId: string): Promise<OAuthClient[]> {
    const result = await db
      .select({
        client_id: oauthClientsTable.client_id,
        client_secret: oauthClientsTable.client_secret,
        client_name: oauthClientsTable.client_name,
        email: usersTable.email,
        user_id: oauthClientsTable.user_id,
        redirect_uris: oauthClientsTable.redirect_uris,
        grant_types: oauthClientsTable.grant_types,
        response_types: oauthClientsTable.response_types,
        token_endpoint_auth_method: oauthClientsTable.token_endpoint_auth_method,
        scope: oauthClientsTable.scope,
        can_access_admin: oauthClientsTable.can_access_admin,
        client_uri: oauthClientsTable.client_uri,
        logo_uri: oauthClientsTable.logo_uri,
        contacts: oauthClientsTable.contacts,
        tos_uri: oauthClientsTable.tos_uri,
        policy_uri: oauthClientsTable.policy_uri,
        software_id: oauthClientsTable.software_id,
        software_version: oauthClientsTable.software_version,
        created_at: oauthClientsTable.created_at,
        updated_at: oauthClientsTable.updated_at,
      })
      .from(oauthClientsTable)
      .leftJoin(usersTable, eq(oauthClientsTable.user_id, usersTable.id))
      .where(eq(oauthClientsTable.user_id, userId));
    return result as OAuthClient[];
  }

  async updateClientAdminAccess(
    clientId: string,
    canAccessAdmin: boolean,
  ): Promise<void> {
    await db
      .update(oauthClientsTable)
      .set({ can_access_admin: canAccessAdmin, updated_at: new Date() })
      .where(eq(oauthClientsTable.client_id, clientId));
  }

  async deleteClient(clientId: string): Promise<void> {
    // Explicitly delete all related records to ensure clean deletion
    // (CASCADE DELETE should handle this, but we explicitly clean up to be safe)
    await db.transaction(async (tx) => {
      // Delete all access tokens for this client
      await tx
        .delete(oauthAccessTokensTable)
        .where(eq(oauthAccessTokensTable.client_id, clientId));

      // Delete all authorization codes for this client
      await tx
        .delete(oauthAuthorizationCodesTable)
        .where(eq(oauthAuthorizationCodesTable.client_id, clientId));

      // Finally, delete the client itself
      await tx
        .delete(oauthClientsTable)
        .where(eq(oauthClientsTable.client_id, clientId));
    });
  }

  async updateClientUserId(
    clientId: string,
    userId: string,
  ): Promise<void> {
    await db
      .update(oauthClientsTable)
      .set({ user_id: userId, updated_at: new Date() })
      .where(eq(oauthClientsTable.client_id, clientId));
  }

  async setClientUserIdIfNotSet(
    clientId: string,
    userId: string,
  ): Promise<void> {
    // Only update if user_id is not already set
    await db
      .update(oauthClientsTable)
      .set({ user_id: userId, updated_at: new Date() })
      .where(
        and(
          eq(oauthClientsTable.client_id, clientId),
          isNull(oauthClientsTable.user_id)
        )
      );
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
    data: OAuthAccessTokenCreateInput,
  ): Promise<void> {
    await db.insert(oauthAccessTokensTable).values({
      access_token: token,
      client_id: data.client_id,
      user_id: data.user_id,
      scope: data.scope,
      expires_at: new Date(data.expires_at),
    });
  }

  async deleteAccessToken(token: string): Promise<void> {
    await db
      .delete(oauthAccessTokensTable)
      .where(eq(oauthAccessTokensTable.access_token, token));
  }

  // ===== Cleanup =====

  async cleanupExpired(): Promise<void> {
    const now = new Date();
    await Promise.all([
      db
        .delete(oauthAuthorizationCodesTable)
        .where(lt(oauthAuthorizationCodesTable.expires_at, now)),
      db
        .delete(oauthAccessTokensTable)
        .where(lt(oauthAccessTokensTable.expires_at, now)),
    ]);
  }
}

export const oauthRepository = new OAuthRepository();
