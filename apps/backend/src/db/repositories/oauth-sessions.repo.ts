import {
  DatabaseOAuthSession,
  OAuthSessionCreateInput,
  OAuthSessionUpdateInput,
} from "@repo/zod-types";
import { eq, sql } from "drizzle-orm";

import { db } from "../index";
import { oauthSessionsTable } from "../schema";

const hasOwn = <T extends object, K extends PropertyKey>(
  input: T,
  key: K,
): input is T & Record<K, unknown> =>
  Object.prototype.hasOwnProperty.call(input, key);

const toDate = (value: string | Date | null | undefined) => {
  if (value === null || value === undefined) {
    return value;
  }
  return value instanceof Date ? value : new Date(value);
};

export class OAuthSessionsRepository {
  async findByMcpServerUuid(
    mcpServerUuid: string,
  ): Promise<DatabaseOAuthSession | undefined> {
    const [session] = await db
      .select()
      .from(oauthSessionsTable)
      .where(eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid))
      .limit(1);

    return session;
  }

  async create(input: OAuthSessionCreateInput): Promise<DatabaseOAuthSession> {
    const [createdSession] = await db
      .insert(oauthSessionsTable)
      .values({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(hasOwn(input, "client_information") && {
          client_information: input.client_information,
        }),
        ...(hasOwn(input, "tokens") && { tokens: input.tokens }),
        ...(hasOwn(input, "code_verifier") && {
          code_verifier: input.code_verifier,
        }),
        ...(hasOwn(input, "tokens_obtained_at") && {
          tokens_obtained_at: toDate(input.tokens_obtained_at),
        }),
        ...(hasOwn(input, "token_expires_at") && {
          token_expires_at: toDate(input.token_expires_at),
        }),
      })
      .returning();

    return createdSession;
  }

  async update(
    input: OAuthSessionUpdateInput,
  ): Promise<DatabaseOAuthSession | undefined> {
    const [updatedSession] = await db
      .update(oauthSessionsTable)
      .set({
        ...(hasOwn(input, "client_information") && {
          client_information: input.client_information,
        }),
        ...(hasOwn(input, "tokens") && { tokens: input.tokens }),
        ...(hasOwn(input, "code_verifier") && {
          code_verifier: input.code_verifier,
        }),
        ...(hasOwn(input, "tokens_obtained_at") && {
          tokens_obtained_at: toDate(input.tokens_obtained_at),
        }),
        ...(hasOwn(input, "token_expires_at") && {
          token_expires_at: toDate(input.token_expires_at),
        }),
        updated_at: sql`NOW()`,
      })
      .where(eq(oauthSessionsTable.mcp_server_uuid, input.mcp_server_uuid))
      .returning();

    return updatedSession;
  }

  async upsert(input: OAuthSessionUpdateInput): Promise<DatabaseOAuthSession> {
    // Check if session exists
    const existingSession = await this.findByMcpServerUuid(
      input.mcp_server_uuid,
    );

    if (existingSession) {
      // Update existing session
      const updatedSession = await this.update(input);
      if (!updatedSession) {
        throw new Error("Failed to update OAuth session");
      }
      return updatedSession;
    } else {
      // Create new session
      return await this.create(input);
    }
  }

  async deleteByMcpServerUuid(
    mcpServerUuid: string,
  ): Promise<DatabaseOAuthSession | undefined> {
    const [deletedSession] = await db
      .delete(oauthSessionsTable)
      .where(eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid))
      .returning();

    return deletedSession;
  }

  async clearByMcpServerUuid(
    mcpServerUuid: string,
    scope: "all" | "client" | "tokens" | "verifier" = "all",
  ): Promise<DatabaseOAuthSession | undefined> {
    const values =
      scope === "all"
        ? {
            client_information: null,
            tokens: null,
            code_verifier: null,
            tokens_obtained_at: null,
            token_expires_at: null,
          }
        : scope === "client"
          ? {
              client_information: null,
              tokens: null,
              code_verifier: null,
              tokens_obtained_at: null,
              token_expires_at: null,
            }
          : scope === "tokens"
            ? {
                tokens: null,
                code_verifier: null,
                tokens_obtained_at: null,
                token_expires_at: null,
              }
            : {
                code_verifier: null,
              };

    const [updatedSession] = await db
      .update(oauthSessionsTable)
      .set({
        ...values,
        updated_at: sql`NOW()`,
      })
      .where(eq(oauthSessionsTable.mcp_server_uuid, mcpServerUuid))
      .returning();

    return updatedSession;
  }
}

export const oauthSessionsRepository = new OAuthSessionsRepository();
