"use client";

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { useEffect, useRef } from "react";

import { useTranslations } from "@/hooks/useTranslations";

import { getServerSpecificKey, SESSION_KEYS } from "../lib/constants";
import { createAuthProvider } from "../lib/oauth-provider";
import { vanillaTrpcClient } from "../lib/trpc";

const OAuthCallback = () => {
  const { t } = useTranslations();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      // Skip if we've already processed this callback
      if (hasProcessedRef.current) {
        return;
      }
      hasProcessedRef.current = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const serverUrl = sessionStorage.getItem(SESSION_KEYS.SERVER_URL);
      const mcpServerUuid = sessionStorage.getItem(
        SESSION_KEYS.MCP_SERVER_UUID,
      );

      const clearPendingOAuth = async () => {
        if (serverUrl) {
          sessionStorage.removeItem(
            getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, serverUrl),
          );
          sessionStorage.removeItem(
            getServerSpecificKey(SESSION_KEYS.OAUTH_STATE, serverUrl),
          );
        }
        if (mcpServerUuid) {
          try {
            await vanillaTrpcClient.frontend.oauth.clear.mutate({
              mcp_server_uuid: mcpServerUuid,
              scope: "verifier",
            });
          } catch (clearError) {
            console.error("Failed to clear OAuth verifier:", clearError);
          }
        }
      };

      if (!code || !state || !serverUrl || !mcpServerUuid) {
        console.error("Missing required OAuth parameters");
        await clearPendingOAuth();
        window.location.href = "/mcp-servers";
        return;
      }

      try {
        // Create auth provider with existing server UUID and URL
        const authProvider = createAuthProvider(mcpServerUuid, serverUrl);

        if (!authProvider.validateState(state)) {
          throw new Error("OAuth state mismatch");
        }

        // Complete the OAuth flow
        const result = await auth(authProvider, {
          serverUrl,
          authorizationCode: code,
        });

        if (result !== "AUTHORIZED") {
          throw new Error(
            `Expected to be authorized after providing auth code, got: ${result}`,
          );
        }

        // Transfer OAuth data from session storage to database
        const clientInformationKey = getServerSpecificKey(
          SESSION_KEYS.CLIENT_INFORMATION,
          serverUrl,
        );
        const tokensKey = getServerSpecificKey(SESSION_KEYS.TOKENS, serverUrl);
        const codeVerifierKey = getServerSpecificKey(
          SESSION_KEYS.CODE_VERIFIER,
          serverUrl,
        );

        const clientInformation = sessionStorage.getItem(clientInformationKey);
        const tokens = sessionStorage.getItem(tokensKey);
        const parsedTokens = tokens ? JSON.parse(tokens) : undefined;
        const tokensObtainedAt = parsedTokens ? new Date() : null;

        // Save OAuth session in database using tRPC
        await vanillaTrpcClient.frontend.oauth.upsert.mutate({
          mcp_server_uuid: mcpServerUuid,
          client_information: clientInformation
            ? JSON.parse(clientInformation)
            : undefined,
          tokens: parsedTokens,
          code_verifier: null,
          tokens_obtained_at: tokensObtainedAt?.toISOString() ?? null,
          token_expires_at:
            parsedTokens?.expires_in && tokensObtainedAt
              ? new Date(
                  tokensObtainedAt.getTime() + parsedTokens.expires_in * 1000,
                ).toISOString()
              : null,
        });

        // Clean up session storage
        sessionStorage.removeItem(clientInformationKey);
        sessionStorage.removeItem(tokensKey);
        sessionStorage.removeItem(codeVerifierKey);
        sessionStorage.removeItem(
          getServerSpecificKey(SESSION_KEYS.OAUTH_STATE, serverUrl),
        );
        sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
        sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);

        // Redirect back to the MCP server detail page
        window.location.href = `/mcp-servers/${mcpServerUuid}`;
      } catch (error) {
        console.error("OAuth callback error:", error);
        await clearPendingOAuth();
        window.location.href = "/mcp-servers";
      }
    };

    void handleCallback();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">
        {t("common:oauth.processingCallback")}
      </p>
    </div>
  );
};

export default OAuthCallback;
