import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import { oauthSessionsRepository } from "../../db/repositories";
import { tryRefreshUpstreamTokens } from "../oauth-upstream/refresh-on-401";
import { recoverFromPostAuthRace } from "../oauth-upstream/retry-post-auth";
import { isUpstreamUnauthorizedError } from "../oauth-upstream/token-exchange";
import { ProcessManagedStdioTransport } from "../stdio-transport/process-managed-transport";
import { metamcpLogStore } from "./log-store";
import { serverErrorTracker } from "./server-error-tracker";
import { resolveEnvVariables } from "./utils";

const sleep = (time: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), time));

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void;
}

/**
 * Transforms localhost URLs to use host.docker.internal when running inside Docker
 */
export const transformDockerUrl = (url: string): string => {
  if (process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL === "true") {
    const transformed = url.replace(
      /localhost|127\.0\.0\.1/g,
      "host.docker.internal",
    );
    return transformed;
  }
  return url;
};

export const createMetaMcpClient = (
  serverParams: ServerParameters,
): { client: Client | undefined; transport: Transport | undefined } => {
  let transport: Transport | undefined;

  // Create the appropriate transport based on server type
  // Default to "STDIO" if type is undefined
  if (!serverParams.type || serverParams.type === "STDIO") {
    // Resolve environment variable placeholders
    const resolvedEnv = serverParams.env
      ? resolveEnvVariables(serverParams.env)
      : undefined;

    const stdioParams: StdioServerParameters = {
      command: serverParams.command || "",
      args: serverParams.args || undefined,
      env: resolvedEnv,
      stderr: "pipe",
    };
    transport = new ProcessManagedStdioTransport(stdioParams);

    // Handle stderr stream when set to "pipe"
    if ((transport as ProcessManagedStdioTransport).stderr) {
      const stderrStream = (transport as ProcessManagedStdioTransport).stderr;

      stderrStream?.on("data", (chunk: Buffer) => {
        metamcpLogStore.addLog(
          serverParams.name,
          "error",
          chunk.toString().trim(),
        );
      });

      stderrStream?.on("error", (error: Error) => {
        metamcpLogStore.addLog(
          serverParams.name,
          "error",
          "stderr error",
          error,
        );
      });
    }
  } else if (serverParams.type === "SSE" && serverParams.url) {
    // Transform the URL if TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is set to "true"
    const transformedUrl = transformDockerUrl(serverParams.url);

    // Build headers: start with custom headers, then add auth header
    const headers: Record<string, string> = {
      ...(serverParams.headers || {}),
    };

    // Check for authentication - prioritize OAuth tokens, fallback to bearerToken
    const authToken =
      serverParams.oauth_tokens?.access_token || serverParams.bearerToken;
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const hasHeaders = Object.keys(headers).length > 0;

    if (!hasHeaders) {
      transport = new SSEClientTransport(new URL(transformedUrl));
    } else {
      transport = new SSEClientTransport(new URL(transformedUrl), {
        requestInit: {
          headers,
        },
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
      });
    }
  } else if (serverParams.type === "STREAMABLE_HTTP" && serverParams.url) {
    // Transform the URL if TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL is set to "true"
    const transformedUrl = transformDockerUrl(serverParams.url);

    // Build headers: start with custom headers, then add auth header
    const headers: Record<string, string> = {
      ...(serverParams.headers || {}),
    };

    // Check for authentication - prioritize OAuth tokens, fallback to bearerToken
    const authToken =
      serverParams.oauth_tokens?.access_token || serverParams.bearerToken;
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const hasHeaders = Object.keys(headers).length > 0;

    if (!hasHeaders) {
      transport = new StreamableHTTPClientTransport(new URL(transformedUrl));
    } else {
      transport = new StreamableHTTPClientTransport(new URL(transformedUrl), {
        requestInit: {
          headers,
        },
      });
    }
  } else {
    metamcpLogStore.addLog(
      serverParams.name,
      "error",
      `Unsupported server type: ${serverParams.type}`,
    );
    return { client: undefined, transport: undefined };
  }

  const client = new Client(
    {
      name: "metamcp-client",
      version: "2.0.0",
    },
    {
      // MetaMCP connects to backend servers as a client; prompts/resources/tools
      // are server-side capabilities and are no longer valid here under MCP SDK
      // 1.26's tightened client capability type.
      capabilities: {},
    },
  );
  return { client, transport };
};

export const connectMetaMcpClient = async (
  serverParams: ServerParameters,
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void,
): Promise<ConnectedClient | undefined> => {
  const waitFor = 5000;

  // Get max attempts from server error tracker instead of hardcoding
  const maxAttempts = await serverErrorTracker.getServerMaxAttempts(
    serverParams.uuid,
  );
  let count = 0;
  let retry = true;

  logger.info(
    `Connecting to server ${serverParams.name} (${serverParams.uuid}) with max attempts: ${maxAttempts}`,
  );
  metamcpLogStore.addLog(
    serverParams.name,
    "info",
    `Connecting to server ${serverParams.uuid} with max attempts: ${maxAttempts}`,
  );

  // Build a fresh transport+client and run the SDK's initialize handshake.
  // Owns its own cleanup-on-failure so the helper can be called multiple
  // times in a single outer iteration (post-auth fast-retry path) without
  // leaking orphaned transports. Returns `undefined` only when
  // `createMetaMcpClient` declines to build a transport (non-retryable); a
  // server previously flagged ERROR is still attempted and self-heals on
  // success (see wasInErrorState below).
  const attemptConnect = async (): Promise<ConnectedClient | undefined> => {
    let transport: Transport | undefined;
    let client: Client | undefined;

    try {
      // Remember whether this server was previously flagged ERROR. We used to
      // return early here, which turned ERROR into a one-way trapdoor: a server
      // that had since recovered could never reconnect, so it could never clear
      // the flag — only a manual UI edit/save would. Instead, attempt the
      // connection and, on success, clear the flag below. If it genuinely keeps
      // crashing, the crash tracker re-flags it.
      const wasInErrorState = await serverErrorTracker.isServerInErrorState(
        serverParams.uuid,
      );

      const result = createMetaMcpClient(serverParams);
      client = result.client;
      transport = result.transport;

      if (!client || !transport) {
        return undefined;
      }

      // Set up process crash detection for STDIO transports BEFORE connecting
      if (transport instanceof ProcessManagedStdioTransport) {
        logger.info(
          `Setting up crash handler for server ${serverParams.name} (${serverParams.uuid})`,
        );
        transport.onprocesscrash = (exitCode, signal) => {
          logger.info(
            `Process crashed for server ${serverParams.name} (${serverParams.uuid}): code=${exitCode}, signal=${signal}`,
          );
          metamcpLogStore.addLog(
            serverParams.name,
            "error",
            `Process crashed with code ${exitCode ?? "null"} and signal ${signal ?? "null"}`,
          );

          // Notify the pool about the crash
          if (onProcessCrash) {
            logger.info(
              `Calling onProcessCrash callback for server ${serverParams.name} (${serverParams.uuid})`,
            );
            onProcessCrash(exitCode, signal);
          } else {
            logger.info(
              `No onProcessCrash callback provided for server ${serverParams.name} (${serverParams.uuid})`,
            );
          }
        };
      }

      await client.connect(transport);
      metamcpLogStore.addLog(
        serverParams.name,
        "info",
        `Connected to server ${serverParams.uuid}`,
      );

      // Connection succeeded — self-heal any prior ERROR state so a recovered
      // server isn't left flagged red forever.
      if (wasInErrorState) {
        logger.info(
          `Server ${serverParams.name} (${serverParams.uuid}) reconnected successfully; clearing prior ERROR state.`,
        );
        await serverErrorTracker.resetServerErrorState(serverParams.uuid);
      }

      const connectedTransport = transport;
      const connectedClient = client;
      return {
        client: connectedClient,
        cleanup: async () => {
          await connectedTransport.close();
          await connectedClient.close();
        },
        onProcessCrash: (exitCode, signal) => {
          logger.warn(
            `Process crash detected for server ${serverParams.name} (${serverParams.uuid}): code=${exitCode}, signal=${signal}`,
          );
          if (onProcessCrash) {
            onProcessCrash(exitCode, signal);
          }
        },
      };
    } catch (error) {
      // Clean up transport/process on connection failure so this attempt
      // does not leave orphaned resources behind. Rethrow so the caller
      // can decide whether to recover (fast retry / 401 refresh) or
      // surface the failure.
      if (transport) {
        try {
          await transport.close();
          console.log(
            `Cleaned up transport for failed connection to ${serverParams.name} (${serverParams.uuid})`,
          );
        } catch (cleanupError) {
          console.error(
            `Error cleaning up transport for ${serverParams.name} (${serverParams.uuid}):`,
            cleanupError,
          );
        }
      }
      if (client) {
        try {
          await client.close();
        } catch (_cleanupError) {
          // Client may not be fully initialized, ignore
        }
      }
      throw error;
    }
  };

  while (retry) {
    try {
      const connected = await attemptConnect();
      return connected;
    } catch (error) {
      metamcpLogStore.addLog(
        "client",
        "error",
        `Error connecting to MetaMCP client (attempt ${count + 1}/${maxAttempts})`,
        error,
      );

      const isHttpServer =
        serverParams.type === "SSE" || serverParams.type === "STREAMABLE_HTTP";

      // Recovery cascade — ORDER IS LOAD-BEARING. Do not reorder without
      // re-reading the rationale below.
      //
      //   refresh-on-401  →  post-auth race recovery  →  count++ / back-off
      //
      // Why this order:
      //
      //   - 401-refresh MUST run first. An expired access_token surfaces
      //     as a 401 from the upstream during initialize; the refresh
      //     helper rotates it server-side and `continue`s the outer
      //     loop. The post-auth race branch's error matrix refuses 4xx
      //     as a belt-and-braces second line of defence, but routing
      //     401s through refresh-on-401 first is what actually fixes
      //     the connection. If you swap the order, refresh stops
      //     running and the connection just retries with the same dead
      //     token until `maxAttempts` exhausts.
      //
      //   - Post-auth race recovery is second. It owns the narrow
      //     symptom set (empty body / ECONNREFUSED / 5xx-with-empty-body)
      //     that fires immediately after `exchangeToken` writes tokens.
      //     The helper enforces a 10s window so chronically-broken
      //     servers fall through to the outer back-off instead of
      //     getting stuck in fast-retry loops.
      //
      //   - count++ / sleep(waitFor) is last. The 5s wait is too long
      //     for the post-auth race (resolves in ~250ms) but is the
      //     right cadence for anything else.
      //
      // 1. Refresh-on-401: if the upstream MCP server returned an
      //    unauthorized response and we have a refresh_token on file, try
      //    a server-to-server refresh once before counting this as a
      //    retry. On success the next loop iteration rebuilds the
      //    transport using the freshly-rotated access_token; on failure
      //    we fall through.
      if (
        isHttpServer &&
        serverParams.oauth_tokens?.refresh_token &&
        isUpstreamUnauthorizedError(error)
      ) {
        try {
          const refresh = await tryRefreshUpstreamTokens(serverParams);
          if (refresh.status === "refreshed" && refresh.tokens) {
            serverParams.oauth_tokens = {
              access_token: refresh.tokens.access_token,
              token_type: refresh.tokens.token_type,
              expires_in: refresh.tokens.expires_in,
              scope:
                typeof refresh.tokens.scope === "string"
                  ? refresh.tokens.scope
                  : undefined,
              refresh_token:
                typeof refresh.tokens.refresh_token === "string"
                  ? refresh.tokens.refresh_token
                  : undefined,
            };
            logger.info(
              `[oauth] upstream 401 refreshed for ${serverParams.name} (${serverParams.uuid}); retrying connect`,
            );
            // Refresh is the recovery, not a backoff-worthy failure.
            continue;
          }
          logger.warn(
            `[oauth] upstream 401 refresh did not recover ${serverParams.name} ` +
              `(${serverParams.uuid}): ${refresh.status}${
                refresh.error ? ` (${refresh.error})` : ""
              }`,
          );
        } catch (refreshError) {
          logger.error(
            `[oauth] upstream 401 refresh threw for ${serverParams.name} (${serverParams.uuid}):`,
            refreshError,
          );
        }
      }

      // 2. Post-auth race recovery (issue #298): if tokens were issued
      //    recently AND the failure matches the empirical post-auth
      //    symptom set (empty body / ECONNREFUSED / 5xx-with-empty-body),
      //    the upstream is likely still wiring up its per-session state.
      //    Retry the handshake with short exponential backoff before
      //    counting against `maxAttempts`. The helper enforces both the
      //    window check AND the error matrix; we do not need to re-check
      //    here. The 401-refresh branch above runs first so a real auth
      //    failure (4xx) is not caught here — the helper itself also
      //    refuses 4xx-status errors as a second line of defence.
      if (isHttpServer) {
        try {
          const session = await oauthSessionsRepository.findByMcpServerUuid(
            serverParams.uuid,
          );
          // Approximation. `oauth_sessions.updated_at` is bumped by every
          // write to the row — token upserts (the signal we care about),
          // `state()` seeding `expected_state`, the post-success
          // clearExpectedState, and code_verifier writes. After any of
          // those, a network blip within 10s falsely triggers up to 3
          // fast retries. Cost: ~1.75s of harmless backoff. The helper's
          // narrow error matrix still refuses terminal failures, so the
          // approximation cannot cause runaway retries on a real outage.
          // A precise `tokens_issued_at` column would be a follow-up.
          const tokensRecentlyTouchedAt =
            session?.tokens && session.updated_at
              ? new Date(session.updated_at)
              : null;
          const recovery = await recoverFromPostAuthRace(attemptConnect, {
            initialError: error,
            tokensIssuedAt: tokensRecentlyTouchedAt,
          });
          if (recovery.kind === "succeeded") {
            logger.info(
              `[oauth] post-auth race recovered for ${serverParams.name} (${serverParams.uuid})`,
            );
            // recovery.value is undefined only when attemptConnect saw
            // the server flip to ERROR state mid-retry; treat as terminal.
            return recovery.value ?? undefined;
          }
          if (recovery.kind === "exhausted") {
            logger.warn(
              `[oauth] post-auth race recovery exhausted for ${serverParams.name} ` +
                `(${serverParams.uuid}) after ${recovery.attempts} retries`,
            );
            // Fall through to count++ — the outer loop's longer backoff
            // gives the upstream more time before we surrender entirely.
          }
          // recovery.kind === "skipped" → out-of-window or non-retryable;
          // no log line here, fall through to the normal retry path.
        } catch (recoveryError) {
          logger.error(
            `[oauth] post-auth race recovery threw for ${serverParams.name} (${serverParams.uuid}):`,
            recoveryError,
          );
        }
      }

      count++;
      retry = count < maxAttempts;
      if (retry) {
        await sleep(waitFor);
      }
    }
  }

  return undefined;
};
