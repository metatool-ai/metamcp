"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useTranslations } from "@/hooks/useTranslations";

import { getServerSpecificKey, SESSION_KEYS } from "../lib/constants";
import { vanillaTrpcClient } from "../lib/trpc";

type CallbackStatus =
  | { kind: "pending" }
  | { kind: "error"; error: string; description?: string };

// Drop every sessionStorage entry the SDK used during the pre-redirect half
// of the flow. Called from both the success and the error paths so a
// failed exchange leaves no stale state to confuse a retry — the next
// authorize click starts fresh.
//
// `serverUrl` is only known after we read sessionStorage; when it's null
// (e.g. the upstream-error or missing-parameters early returns) we can
// still clear the unscoped keys.
function clearOAuthSessionKeys(serverUrl: string | null): void {
  if (serverUrl) {
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CLIENT_INFORMATION, serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.TOKENS, serverUrl),
    );
    sessionStorage.removeItem(
      getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, serverUrl),
    );
  }
  sessionStorage.removeItem(SESSION_KEYS.SERVER_URL);
  sessionStorage.removeItem(SESSION_KEYS.MCP_SERVER_UUID);
}

const OAuthCallback = () => {
  const { t } = useTranslations();
  const hasProcessedRef = useRef(false);
  const [status, setStatus] = useState<CallbackStatus>({ kind: "pending" });

  useEffect(() => {
    const handleCallback = async () => {
      // Skip if we've already processed this callback (e.g. React strict mode)
      if (hasProcessedRef.current) {
        return;
      }
      hasProcessedRef.current = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state") ?? undefined;
      const upstreamError = params.get("error");
      const upstreamErrorDescription =
        params.get("error_description") ?? undefined;
      const serverUrl = sessionStorage.getItem(SESSION_KEYS.SERVER_URL);
      const mcpServerUuid = sessionStorage.getItem(
        SESSION_KEYS.MCP_SERVER_UUID,
      );

      // Upstream sent back an OAuth error response (user denied, invalid
      // scope, ...). Surface it instead of pretending the flow succeeded.
      if (upstreamError) {
        clearOAuthSessionKeys(serverUrl);
        setStatus({
          kind: "error",
          error: upstreamError,
          description: upstreamErrorDescription,
        });
        return;
      }

      if (!code || !serverUrl || !mcpServerUuid) {
        clearOAuthSessionKeys(serverUrl);
        setStatus({
          kind: "error",
          error: "missing_callback_parameters",
          description:
            "The OAuth callback URL is missing `code`, or the browser session lost track of which MCP server initiated the flow. Please re-trigger the authorize button.",
        });
        return;
      }

      try {
        // The browser-side SDK already ran discovery, registration (if
        // needed), `saveCodeVerifier`, and the redirect to the upstream's
        // authorize endpoint. The remaining step — POSTing the code to the
        // upstream's token endpoint — moves to the backend because most
        // enterprise providers (Salesforce, Okta, Auth0, ...) do not
        // expose CORS-permissive token endpoints.
        // Note: we deliberately do NOT pass serverUrl to the backend. The
        // backend looks up the upstream URL from `mcp_servers` keyed by
        // uuid; accepting it from the browser would let any authenticated
        // user steer the server-side token POST at an attacker-controlled
        // host (SSRF / authorization-code exfiltration).
        const result =
          await vanillaTrpcClient.frontend.oauth.exchangeToken.mutate({
            mcp_server_uuid: mcpServerUuid,
            code,
            state,
          });

        if (!result.success) {
          clearOAuthSessionKeys(serverUrl);
          setStatus({
            kind: "error",
            error: result.error,
            description: result.error_description,
          });
          return;
        }

        // Backend persisted tokens directly into oauth_sessions; we no
        // longer need to mirror anything from sessionStorage.
        clearOAuthSessionKeys(serverUrl);

        window.location.href = `/mcp-servers/${mcpServerUuid}`;
      } catch (error) {
        console.error("OAuth callback error:", error);
        clearOAuthSessionKeys(serverUrl);
        setStatus({
          kind: "error",
          error: "callback_failed",
          description:
            error instanceof Error
              ? error.message
              : "Unexpected error during OAuth callback.",
        });
      }
    };

    void handleCallback();
  }, []);

  if (status.kind === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">
          {t("common:oauth.callbackFailedTitle")}
        </h1>
        <p className="text-red-600 font-medium">{status.error}</p>
        {status.description && (
          <p className="max-w-2xl text-sm text-muted-foreground whitespace-pre-wrap">
            {status.description}
          </p>
        )}
        <Link
          href="/mcp-servers"
          className="text-sm underline text-muted-foreground"
        >
          {t("common:oauth.backToMcpServers")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-lg text-gray-500">
        {t("common:oauth.processingCallback")}
      </p>
    </div>
  );
};

export default OAuthCallback;
