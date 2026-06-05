import {
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  OAuthProxyFetchRequestSchema,
  OAuthProxyFetchResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import {
  mcpServersRepository,
  oauthSessionsRepository,
} from "../db/repositories";
import { OAuthSessionsSerializer } from "../db/serializers";

export const oauthImplementations = {
  get: async (
    input: z.infer<typeof GetOAuthSessionRequestSchema>,
  ): Promise<z.infer<typeof GetOAuthSessionResponseSchema>> => {
    try {
      const session = await oauthSessionsRepository.findByMcpServerUuid(
        input.mcp_server_uuid,
      );

      if (!session) {
        return {
          success: false as const,
          message: "OAuth session not found",
        };
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session retrieved successfully",
      };
    } catch (error) {
      logger.error("Error fetching OAuth session:", error);
      return {
        success: false as const,
        message: "Failed to fetch OAuth session",
      };
    }
  },

  upsert: async (
    input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
  ): Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>> => {
    try {
      const session = await oauthSessionsRepository.upsert({
        mcp_server_uuid: input.mcp_server_uuid,
        ...(input.client_information && {
          client_information: input.client_information,
        }),
        ...(input.tokens && { tokens: input.tokens }),
        ...(input.code_verifier && { code_verifier: input.code_verifier }),
      });

      if (!session) {
        return {
          success: false as const,
          error: "Failed to upsert OAuth session",
        };
      }

      return {
        success: true as const,
        data: OAuthSessionsSerializer.serializeOAuthSession(session),
        message: "OAuth session upserted successfully",
      };
    } catch (error) {
      logger.error("Error upserting OAuth session:", error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  // Server-side OAuth fetch proxy. The MCP OAuth flow (discovery, dynamic client
  // registration, token exchange, refresh) is driven from the browser, which
  // fails for upstream OAuth servers that don't send CORS headers. Routing those
  // requests through the backend (server-to-server) avoids CORS entirely.
  proxyFetch: async (
    input: z.infer<typeof OAuthProxyFetchRequestSchema>,
  ): Promise<z.infer<typeof OAuthProxyFetchResponseSchema>> => {
    try {
      const server = await mcpServersRepository.findByUuid(
        input.mcp_server_uuid,
      );
      if (!server || !server.url) {
        return {
          success: false as const,
          error: "MCP server not found or has no URL",
        };
      }

      // SSRF guard: only proxy to the same host as the configured server URL,
      // over https — the same host MetaMCP already connects to for MCP traffic.
      const allowedHost = new URL(server.url).host;
      const target = new URL(input.url);
      if (target.protocol !== "https:" || target.host !== allowedHost) {
        return {
          success: false as const,
          error: `Refusing to proxy OAuth request to ${target.host} (only https://${allowedHost} is allowed)`,
        };
      }

      const forwardHeaders = (): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(input.headers ?? {})) {
          const lower = key.toLowerCase();
          if (
            ["host", "content-length", "cookie", "connection"].includes(lower)
          ) {
            continue;
          }
          out[key] = value;
        }
        return out;
      };

      const doFetch = (u: string) =>
        fetch(u, {
          method: input.method,
          headers: forwardHeaders(),
          body:
            input.method === "GET" || input.method === "HEAD"
              ? undefined
              : input.body,
          redirect: "follow",
        });

      let response = await doFetch(target.toString());

      // Some providers advertise a protected-resource metadata URL with an extra
      // path segment that 403/404s while the spec base path works. Retry base.
      if (
        (response.status === 403 || response.status === 404) &&
        target.pathname.startsWith("/.well-known/oauth-protected-resource/")
      ) {
        const fallback = new URL(target.toString());
        fallback.pathname = "/.well-known/oauth-protected-resource";
        const fallbackResponse = await doFetch(fallback.toString());
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        }
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        success: true as const,
        status: response.status,
        statusText: response.statusText,
        headers,
        body: await response.text(),
      };
    } catch (error) {
      logger.error("OAuth proxy fetch error:", error);
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : "OAuth proxy fetch failed",
      };
    }
  },
};
