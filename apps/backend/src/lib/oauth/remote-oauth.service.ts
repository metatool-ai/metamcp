import {
  discoverOAuthMetadata,
  discoverOAuthProtectedResourceMetadata,
  refreshAuthorization,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthTokens } from "@repo/zod-types";

import { oauthSessionsRepository } from "../../db/repositories/oauth-sessions.repo";
import logger from "../../utils/logger";

const REFRESH_SKEW_MS = 60_000;

const refreshClientMetadata: OAuthClientMetadata = {
  redirect_uris: ["http://localhost/oauth-refresh-placeholder"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "MetaMCP",
};

const getErrorCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const maybeError = error as { errorCode?: unknown; name?: unknown };
  if (typeof maybeError.errorCode === "string") {
    return maybeError.errorCode;
  }
  if (typeof maybeError.name === "string") {
    return maybeError.name;
  }
  return undefined;
};

const isInvalidOAuthCredentialError = (error: unknown) => {
  const code = getErrorCode(error);
  if (
    code === "invalid_grant" ||
    code === "invalid_client" ||
    code === "invalid_token" ||
    code === "InvalidGrantError" ||
    code === "InvalidClientError" ||
    code === "InvalidTokenError"
  ) {
    return true;
  }

  return error instanceof Error
    ? /invalid_(grant|client|token)|unauthorized/i.test(error.message)
    : false;
};

const computeTokenExpiry = (tokens: OAuthTokens, obtainedAt: Date) =>
  tokens.expires_in
    ? new Date(obtainedAt.getTime() + tokens.expires_in * 1000)
    : null;

const getEffectiveTokenExpiry = (
  tokens: OAuthTokens,
  tokenExpiresAt: Date | null,
  tokensObtainedAt: Date | null,
  updatedAt: Date,
) =>
  tokenExpiresAt ??
  (tokens.expires_in
    ? computeTokenExpiry(tokens, tokensObtainedAt ?? updatedAt)
    : null);

const needsRefresh = (
  tokens: OAuthTokens,
  tokenExpiresAt: Date | null,
  tokensObtainedAt: Date | null,
  updatedAt: Date,
) => {
  const expiresAt = getEffectiveTokenExpiry(
    tokens,
    tokenExpiresAt,
    tokensObtainedAt,
    updatedAt,
  );

  if (!expiresAt) {
    return false;
  }

  return expiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS;
};

export async function clearOAuthCredentialsForServer(
  mcpServerUuid: string,
  scope: "all" | "client" | "tokens" | "verifier" = "tokens",
) {
  await oauthSessionsRepository.clearByMcpServerUuid(mcpServerUuid, scope);
}

export async function getUsableOAuthTokens(
  mcpServerUuid: string,
  serverUrl?: string | null,
): Promise<OAuthTokens | null> {
  const session =
    await oauthSessionsRepository.findByMcpServerUuid(mcpServerUuid);

  if (!session?.tokens) {
    return null;
  }

  if (!serverUrl || !session.client_information) {
    return needsRefresh(
      session.tokens,
      session.token_expires_at,
      session.tokens_obtained_at,
      session.updated_at,
    )
      ? null
      : session.tokens;
  }

  if (
    !needsRefresh(
      session.tokens,
      session.token_expires_at,
      session.tokens_obtained_at,
      session.updated_at,
    )
  ) {
    return session.tokens;
  }

  if (!session.tokens.refresh_token) {
    logger.warn(
      `OAuth token for MCP server ${mcpServerUuid} is expired and cannot be refreshed; reauthorization is required`,
    );
    return null;
  }

  try {
    let resourceMetadata;
    let authorizationServerUrl: string | URL = serverUrl;

    try {
      resourceMetadata =
        await discoverOAuthProtectedResourceMetadata(serverUrl);
      if (resourceMetadata.authorization_servers?.[0]) {
        authorizationServerUrl = resourceMetadata.authorization_servers[0];
      }
    } catch {
      resourceMetadata = undefined;
    }

    const resource = await selectResourceURL(
      serverUrl,
      {
        redirectUrl: refreshClientMetadata.redirect_uris[0],
        clientMetadata: refreshClientMetadata,
        clientInformation: () => session.client_information ?? undefined,
        tokens: () => session.tokens ?? undefined,
        saveTokens: () => undefined,
        redirectToAuthorization: () => undefined,
        saveCodeVerifier: () => undefined,
        codeVerifier: () => "",
      },
      resourceMetadata,
    );

    const metadata = await discoverOAuthMetadata(serverUrl, {
      authorizationServerUrl,
    });

    const refreshedTokens = await refreshAuthorization(authorizationServerUrl, {
      metadata,
      clientInformation: session.client_information,
      refreshToken: session.tokens.refresh_token,
      resource,
    });

    const obtainedAt = new Date();
    await oauthSessionsRepository.upsert({
      mcp_server_uuid: mcpServerUuid,
      tokens: refreshedTokens,
      tokens_obtained_at: obtainedAt,
      token_expires_at: computeTokenExpiry(refreshedTokens, obtainedAt),
      code_verifier: null,
    });

    logger.info(
      `Refreshed OAuth tokens for MCP server ${mcpServerUuid} without exposing token values`,
    );

    return refreshedTokens;
  } catch (error) {
    if (isInvalidOAuthCredentialError(error)) {
      await clearOAuthCredentialsForServer(mcpServerUuid, "tokens");
      logger.warn(
        `Cleared invalid OAuth tokens for MCP server ${mcpServerUuid}; reauthorization is required`,
      );
      return null;
    }

    logger.warn(
      `OAuth token refresh failed for MCP server ${mcpServerUuid}; refusing to use expired token`,
      error,
    );
    return null;
  }
}

export async function clearOAuthTokensOnAuthFailure(
  mcpServerUuid: string,
  error: unknown,
) {
  if (!isInvalidOAuthCredentialError(error)) {
    return false;
  }

  await clearOAuthCredentialsForServer(mcpServerUuid, "tokens");
  logger.warn(
    `Cleared OAuth tokens after upstream auth failure for MCP server ${mcpServerUuid}; reauthorization is required`,
  );
  return true;
}
