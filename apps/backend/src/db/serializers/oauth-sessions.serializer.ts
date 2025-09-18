import {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type DatabaseOAuthSession = {
  uuid: string;
  mcp_server_uuid: string;
  client_information: OAuthClientInformation | null;
  tokens: OAuthTokens | null;
  code_verifier: string | null;
  created_at: Date;
  updated_at: Date;
};

type SerializedOAuthSession = {
  uuid: string;
  mcp_server_uuid: string;
  client_information: OAuthClientInformation | null;
  tokens: OAuthTokens | null;
  code_verifier: string | null;
  created_at: string;
  updated_at: string;
};

export class OAuthSessionsSerializer {
  static serializeOAuthSession(
    dbSession: DatabaseOAuthSession,
  ): SerializedOAuthSession {
    return {
      uuid: dbSession.uuid,
      mcp_server_uuid: dbSession.mcp_server_uuid,
      client_information: dbSession.client_information,
      tokens: dbSession.tokens,
      code_verifier: dbSession.code_verifier,
      created_at: dbSession.created_at.toISOString(),
      updated_at: dbSession.updated_at.toISOString(),
    };
  }
}
