import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  CallToolResultSchema,
  CompatibilityCallToolResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResult,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResult,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ListToolsResult,
  ListToolsResultSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ResourceTemplate,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import logger from "@/utils/logger";

import { namespacesRepository } from "../../db/repositories/namespaces.repo";
import { toolsRepository } from "../../db/repositories/tools.repo";
import { toolsImplementations } from "../../trpc/tools.impl";
import { getAdminToolsContext } from "../admin-mcp/admin-session-context";
import {
  executeAdminTool,
  getAdminToolsForMcp,
  isExposedAdminToolName,
} from "../admin-mcp/tools-registry";
import { configService } from "../config.service";
import { ConnectedClient } from "./client";
import { getMcpServers } from "./fetch-metamcp";
import { extractForwardedHeaders, mergeHeaders } from "./header-forwarding";
import { requestWithSessionRecovery } from "./list-handler-recovery";
import { mcpServerPool } from "./mcp-server-pool";
import { createAuditCallToolMiddleware } from "./metamcp-middleware/audit-requests.functional";
import {
  createFilterCallToolMiddleware,
  createFilterListToolsMiddleware,
} from "./metamcp-middleware/filter-tools.functional";
import {
  CallToolHandler,
  compose,
  ListToolsHandler,
  MetaMCPHandlerContext,
} from "./metamcp-middleware/functional-middleware";
import { resolveToolIdentity } from "./metamcp-middleware/tool-identity";
import {
  createToolOverridesCallToolMiddleware,
  createToolOverridesListToolsMiddleware,
  mapOverrideNameToOriginal,
} from "./metamcp-middleware/tool-overrides.functional";
import { isBackendSessionLostError } from "./session-error";
import { normalizeCallToolResult } from "./call-tool-result";
import { parseToolName } from "./tool-name-parser";
import { backgroundToolsSync } from "./background-tools-sync";
import { circuitBreaker } from "./circuit-breaker";
import { filterOutOverrideTools } from "./override-filter";
import { toolsSyncCache } from "./tools-sync-cache";
import { sanitizeName } from "./utils";

/**
 * Rate-limited DEGRADED logger: aggregates per-namespace degradation and emits
 * at most one log line per window (default 60s) instead of spamming per request.
 */
const degradedLogTimestamps: Map<string, number> = new Map();
const DEGRADED_LOG_WINDOW_MS = 60_000;

function shouldLogDegraded(namespaceUuid: string): boolean {
  const now = Date.now();
  const last = degradedLogTimestamps.get(namespaceUuid) || 0;
  if (now - last >= DEGRADED_LOG_WINDOW_MS) {
    degradedLogTimestamps.set(namespaceUuid, now);
    return true;
  }
  return false;
}

/**
 * Bound a getSession() call with a deadline. The pool's getSession can block
 * for a cold spawn (createNewConnection up to MCP_STDIO_CONNECT_TIMEOUT_MS),
 * and when that happens inside a fan-out (tools/list, prompts/list, ...) it
 * stalls the WHOLE aggregate HTTP response past the client's deadline — the
 * "tools/list never returns" symptom. On timeout we return undefined; the
 * caller surfaces the server via _meta.pending / failedServers instead of
 * stalling. Default 10s; override MCP_TOOLS_LIST_TIMEOUT_MS. The pool still
 * spawns the server in the background (the deadline only abandons THIS
 * request's wait, not the connection).
 */
async function getSessionWithDeadline(
  sessionId: string,
  serverUuid: string,
  params: Parameters<typeof mcpServerPool.getSession>[2],
  namespaceUuid?: string,
): Promise<ConnectedClient | undefined> {
  const timeoutMs = parseInt(
    process.env.MCP_TOOLS_LIST_TIMEOUT_MS || "10000",
    10,
  );
  const sessionPromise = mcpServerPool.getSession(
    sessionId,
    serverUuid,
    params,
    namespaceUuid,
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ConnectedClient | undefined>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(
        `[fan-out] getSession deadline exceeded for server ${serverUuid} after ${timeoutMs}ms — returning as pending; spawn continues in background`,
      );
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([sessionPromise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const createServer = async (
  namespaceUuid: string,
  sessionId: string,
  includeInactiveServers: boolean = false,
  clientRequestHeaders?: Record<string, string>,
  requestContext?: Pick<MetaMCPHandlerContext, "endpointName" | "auth">,
) => {
  const toolToClient: Record<string, ConnectedClient> = {};
  const toolToServerUuid: Record<string, string> = {};
  const promptToClient: Record<string, ConnectedClient> = {};
  const resourceToClient: Record<string, ConnectedClient> = {};

  // Helper function to detect if a server is the same instance
  const isSameServerInstance = (
    params: { name?: string; url?: string | null },
    _serverUuid: string,
  ): boolean => {
    // Check if server name is exactly the same as our current server instance
    // This prevents exact recursive calls to the same server
    if (params.name === `metamcp-unified-${namespaceUuid}`) {
      return true;
    }

    return false;
  };

  const namespace = await namespacesRepository.findByUuid(namespaceUuid);

  const server = new Server(
    {
      name: `metamcp-unified-${namespaceUuid}`,
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      },
      instructions: namespace?.description ?? undefined,
    },
  );

  // Create the handler context.
  // NOTE: clientRequestHeaders are captured once at session initialisation
  // (StreamableHTTP) or connection time (SSE). They are NOT refreshed on
  // subsequent requests within the same session. This is acceptable because
  // headers like Authorization are stable for a session's lifetime, but
  // callers should be aware of this if session-scoped header staleness
  // could be a concern.
  const handlerContext: MetaMCPHandlerContext = {
    namespaceUuid,
    sessionId,
    clientRequestHeaders,
    endpointName: requestContext?.endpointName || "unknown",
    auth: requestContext?.auth,
  };

  // Original List Tools Handler
  const originalListToolsHandler: ListToolsHandler = async (
    request,
    context,
  ) => {
    logger.debug(
      "[DEBUG-TOOLS] 🔍 tools/list called for namespace:",
      namespaceUuid,
    );
    const startTime = performance.now();
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );

    // ---- Serve-from-DB fast path ----
    // Read the fully-scoped tool list for the namespace from the `tools` table
    // (one indexed query, no backend I/O). This is the hot path that keeps
    // tools/list fast under many backends. Stale/absent servers are flagged
    // PENDING and refreshed in the background (or fetched one-off below).
    try {
      const dbTools = await toolsRepository.readToolsForNamespace(
        context.namespaceUuid,
      );

      // If we have cached tools for this namespace, prefer them. Servers with
      // fresh DB rows are served from the DB; servers that are stale or absent
      // are marked PENDING and a background refresh is kicked.
      const serverUuids = Object.keys(serverParams);
      const freshUuids = new Set<string>();
      const pendingServers: string[] = [];

      for (const serverUuid of serverUuids) {
        if (backgroundToolsSync.isFresh(serverUuid)) {
          freshUuids.add(serverUuid);
        } else {
          pendingServers.push(serverUuid);
        }
      }

      if (dbTools.length > 0) {
        // Trigger background refresh for stale/absent servers (debounced,
        // non-blocking). The request returns immediately from the DB.
        for (const [serverUuid, params] of Object.entries(serverParams)) {
          if (!freshUuids.has(serverUuid)) {
            backgroundToolsSync.ensureFresh(
              serverUuid,
              params,
              context.namespaceUuid,
            );
          }
        }

        // Surface circuit-open servers as pending (DEGRADED surfacing): a
        // tripped backend's tools are still served from DB (last-known) but
        // the client sees the server needs a retry, not a hang.
        for (const serverUuid of Object.keys(serverParams)) {
          if (circuitBreaker.isOpen(serverUuid)) {
            if (!pendingServers.includes(serverUuid)) {
              pendingServers.push(serverUuid);
            }
          }
        }

        const dbToolsWithName = dbTools.map((tool) => {
          const serverName = serverParams[tool.mcp_server_uuid]?.name || "";
          const toolName = `${sanitizeName(serverName)}__${tool.name}`;
          // Map the DB row (DatabaseTool: toolSchema) to the SDK Tool shape
          // (inputSchema) and drop DB-only fields so the MCP client sees the
          // standard { name, description, inputSchema } tool.
          return {
            name: toolName,
            description: tool.description ?? undefined,
            inputSchema: tool.toolSchema,
          };
        });

        logger.debug(
          `[DEBUG-TOOLS] ✅ tools/list served from DB in ${(performance.now() - startTime).toFixed(2)}ms (${dbToolsWithName.length} tools, ${pendingServers.length} pending)`,
        );

        return {
          tools: dbToolsWithName,
          ...(pendingServers.length > 0
            ? { _meta: { pending: pendingServers } }
            : {}),
        };
      }
      // No cached tools for this namespace — fall through to the backend
      // fan-out (bounded) below.
    } catch (dbError) {
      // DB read failed — fall through to the backend fan-out rather than
      // returning an error.
      logger.error(
        `tools/list: DB read failed for namespace ${context.namespaceUuid}, falling back to backend fan-out:`,
        dbError,
      );
    }

    // Extract forwarded headers from client request for servers that need them
    const forwardedHeadersByServer = context.clientRequestHeaders
      ? extractForwardedHeaders(context.clientRequestHeaders, serverParams)
      : {};

    const allTools: Tool[] = [];

    // Servers that should have contributed tools but failed even after the
    // recovery retry (or had no session at all). Drives the degraded-response
    // tripwire after the fan-out — a swallowed failure returns a "successful"
    // 0-tool namespace and nobody notices until a manual restart.
    const failedServers: string[] = [];

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // We'll filter servers during processing after getting sessions to check actual MCP server names
    const allServerEntries = Object.entries(serverParams);

    logger.debug(
      `[DEBUG-TOOLS] 📋 Processing ${allServerEntries.length} servers`,
    );

    // Cold-start warmup: if pool has 0 idle + 0 active sessions but servers
    // exist in DB, trigger a LAZY warmup. This used to block on
    // ensureIdleSessions() — a synchronous fan-out that spawned every server
    // at once and blew past the connect timeout (the -32001/-32000 storm).
    // Instead, clear error states and kick off the bounded, sequential
    // prewarm in the background; the per-server getSession() calls below
    // connect on demand and are covered by the extended connect timeout.
    const poolStatus = mcpServerPool.getPoolStatus();
    if (
      poolStatus.idle === 0 &&
      poolStatus.active === 0 &&
      allServerEntries.length > 0
    ) {
      logger.debug(
        `[DEBUG-TOOLS] ⚠️ Cold start: 0 idle, 0 active sessions but ${allServerEntries.length} servers registered. Background prewarm started.`,
      );
      for (const [uuid] of allServerEntries) {
        await mcpServerPool.resetServerErrorState(uuid);
      }
      // Fire-and-forget: the prewarm is bounded (sequential, gated) and the
      // fan-out below will lazy-connect servers that are still cold.
      void mcpServerPool
        .ensureIdleSessions(serverParams, namespaceUuid)
        .then(() => {
          const afterStatus = mcpServerPool.getPoolStatus();
          logger.debug(
            `[DEBUG-TOOLS] ✅ Pool warmup complete: ${afterStatus.idle} idle, ${afterStatus.active} active`,
          );
        })
        .catch((error) => {
          logger.error("[DEBUG-TOOLS] ❌ Pool warmup failed:", error);
        });
    }

    await Promise.allSettled(
      allServerEntries.map(async ([mcpServerUuid, params]) => {
        logger.debug(`[DEBUG-TOOLS] 🔧 Server: ${params.name || mcpServerUuid}`);

        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(mcpServerUuid)) {
          logger.debug(
            `[DEBUG-TOOLS] ⏭️  Skipping already visited: ${params.name}`,
          );
          return;
        }

        // Merge forwarded headers into server params for this session
        const effectiveParams = forwardedHeadersByServer[mcpServerUuid]
          ? {
              ...params,
              headers: mergeHeaders(
                params.headers,
                forwardedHeadersByServer[mcpServerUuid],
              ),
            }
          : params;

        const session = await getSessionWithDeadline(
          context.sessionId,
          mcpServerUuid,
          effectiveParams,
          namespaceUuid,
        );
        if (!session) {
          logger.debug(`[DEBUG-TOOLS] ❌ No session for: ${params.name}`);
          // No pooled session and the pool couldn't create one — server is
          // ERROR-gated, connection-capped, deadline-exceeded, or unreachable.
          // Error level: this server is silently missing from the namespace's
          // tool surface until the pool recovers.
          logger.error(
            `tools/list: no session available for server ${params.name || mcpServerUuid} — excluded from namespace response (error state, connection cap, deadline, or backend unreachable)`,
          );
          failedServers.push(params.name || mcpServerUuid);
          return;
        }

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client.getServerVersion();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${namespaceUuid}`;

        if (actualServerName === ourServerName) {
          logger.info(
            `Skipping self-referencing MetaMCP server: "${actualServerName}"`,
          );
          return;
        }

        // Check basic self-reference patterns
        if (isSameServerInstance(params, mcpServerUuid)) {
          return;
        }

        // Mark this server as visited
        visitedServers.add(mcpServerUuid);

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";

        try {
          const toolFetchStart = performance.now();

          // Bound each backend's tools/list with the namespace-aware MCP timeout
          // so a single hung backend (OAuth re-auth, cold package install)
          // can't stall the whole namespace aggregation.
          const listTimeout = await configService.getMcpTimeoutForNamespace(
            namespace?.name || "",
          );

          // Paginated tool discovery - load all pages automatically
          const fetchAllToolPages = async (
            active: ConnectedClient,
          ): Promise<Tool[]> => {
            const pages: Tool[] = [];
            let cursor: string | undefined = undefined;
            let hasMore = true;

            while (hasMore) {
              const result: ListToolsResult = await active.client.request(
                {
                  method: "tools/list",
                  params: {
                    cursor: cursor,
                    _meta: request.params?._meta,
                  },
                },
                ListToolsResultSchema,
                {
                  timeout: listTimeout,
                  resetTimeoutOnProgress: true,
                },
              );

              if (result.tools && result.tools.length > 0) {
                pages.push(...result.tools);
              }

              cursor = result.nextCursor;
              hasMore = !!result.nextCursor;
            }

            return pages;
          };

          // Invalidate-and-retry-once on session-lost / transport-lost.
          // Without it a dead pooled session is never evicted from here and
          // the namespace serves 0 tools as "success" until a manual restart.
          let activeSession = session;
          const allServerTools = await requestWithSessionRecovery({
            pool: mcpServerPool,
            sessionId: context.sessionId,
            serverUuid: mcpServerUuid,
            params,
            namespaceUuid,
            operation: "tools/list",
            serverName,
            session,
            attempt: fetchAllToolPages,
            onFreshSession: (fresh) => {
              activeSession = fresh;
            },
          });

          logger.debug(
            `[DEBUG-TOOLS] ⏱️  Fetched ${allServerTools.length} tools from ${serverName} in ${(performance.now() - toolFetchStart).toFixed(2)}ms`,
          );

          // Save original tools to database (before middleware processing)
          // This ensures we only save the actual tool names, not override names
          // Filter out tools that are overrides of existing tools to prevent duplicates
          try {
            // PERFORMANCE OPTIMIZATION: Check hash FIRST to avoid expensive operations
            const toolNames = allServerTools.map((tool) => tool.name);
            const hasChanged = toolsSyncCache.hasChanged(
              mcpServerUuid,
              toolNames,
            );

            logger.debug(
              `[DEBUG-TOOLS] 🔍 Hash check for ${serverName}: ${hasChanged ? "CHANGED" : "UNCHANGED"}`,
            );

            if (hasChanged) {
              const toolsToSave = await filterOutOverrideTools(
                allServerTools,
                namespaceUuid,
                serverName,
              );

              if (toolsToSave.length > 0) {
                // Update cache
                toolsSyncCache.update(mcpServerUuid, toolNames);

                // Sync with cleanup
                await toolsImplementations.sync({
                  tools: toolsToSave,
                  mcpServerUuid: mcpServerUuid,
                });
              }
            }
          } catch (dbError) {
            logger.error(
              `Error syncing tools to database for server ${serverName}:`,
              dbError,
            );
          }

          // Use original tools for client response (middleware will be applied later)
          const toolsWithSource = allServerTools.map((tool) => {
            const toolName = `${sanitizeName(serverName)}__${tool.name}`;
            toolToClient[toolName] = activeSession;
            toolToServerUuid[toolName] = mcpServerUuid;

            return {
              ...tool,
              name: toolName,
              description: tool.description,
            };
          });

          allTools.push(...toolsWithSource);
        } catch (error) {
          logger.error(`Error fetching tools from: ${serverName}`, error);
          failedServers.push(serverName || mcpServerUuid);
        }
      }),
    );

    const totalTime = performance.now() - startTime;
    logger.debug(
      `[DEBUG-TOOLS] ✅ tools/list completed in ${totalTime.toFixed(2)}ms, returning ${allTools.length} tools`,
    );

    // Degraded-response tripwire: a server that should have contributed tools
    // failed even after the recovery retry (or had no session). The response
    // is still returned (partial truth beats a hard error for the surviving
    // servers) but the failure must be loud enough for log-based monitoring.
    //
    // A warming/failed server is surfaced to the client as a `_meta`-style
    // `pending` marker (not a hard failure): a client that checks it can
    // retry, and a client that ignores it still gets the healthy tools.
    if (failedServers.length > 0) {
      // Quiet DEGRADED: emit at most once per 60s per namespace so a steady
      // degradation doesn't flood the log; the client still gets _meta.pending.
      if (shouldLogDegraded(namespaceUuid)) {
        logger.error(
          `tools/list DEGRADED for namespace ${namespaceUuid}: ${failedServers.length}/${allServerEntries.length} backend server(s) failed (${failedServers.join(", ")}); returning ${allTools.length} tools`,
        );
      }
    }

    return {
      tools: allTools,
      ...(failedServers.length > 0
        ? { _meta: { pending: failedServers } }
        : {}),
    };
  };

  // Original Call Tool Handler
  const originalCallToolHandler: CallToolHandler = async (request, context) => {
    const { name, arguments: args } = request.params;

    // Parse the tool name using shared utility
    const parsed = parseToolName(name);
    if (!parsed) {
      throw new Error(`Invalid tool name format: ${name}`);
    }

    const { serverName: serverPrefix, originalToolName } = parsed;

    // Try to find the tool in pre-populated mappings first
    let clientForTool = toolToClient[name];
    let serverUuid = toolToServerUuid[name];

    // If not found in mappings, dynamically find the server and route the call
    if (!clientForTool || !serverUuid) {
      try {
        // Get all MCP servers for this namespace
        const serverParams = await getMcpServers(
          namespaceUuid,
          includeInactiveServers,
        );

        // Extract forwarded headers for dynamic tool routing
        const forwardedHeadersByServer = context.clientRequestHeaders
          ? extractForwardedHeaders(context.clientRequestHeaders, serverParams)
          : {};

        // Find the server with the matching name prefix
        for (const [mcpServerUuid, params] of Object.entries(serverParams)) {
          // Merge forwarded headers for this server
          const effectiveParams = forwardedHeadersByServer[mcpServerUuid]
            ? {
                ...params,
                headers: mergeHeaders(
                  params.headers,
                  forwardedHeadersByServer[mcpServerUuid],
                ),
              }
            : params;

          const session = await mcpServerPool.getSession(
            sessionId,
            mcpServerUuid,
            effectiveParams,
            namespaceUuid,
          );

          if (session) {
            const capabilities = session.client.getServerCapabilities();
            if (!capabilities?.tools) continue;

            // Use name assigned by user, fallback to name from server
            const serverName =
              params.name || session.client.getServerVersion()?.name || "";

            if (sanitizeName(serverName) === serverPrefix) {
              // Found the server, now check if it has this tool with pagination
              try {
                let foundTool = false;
                let cursor: string | undefined = undefined;
                let hasMore = true;

                while (hasMore && !foundTool) {
                  const result: ListToolsResult = await session.client.request(
                    {
                      method: "tools/list",
                      params: { cursor: cursor },
                    },
                    ListToolsResultSchema,
                  );

                  if (
                    result.tools?.some(
                      (tool: Tool) => tool.name === originalToolName,
                    )
                  ) {
                    foundTool = true;
                    // Tool exists, populate mappings for future use and use it
                    clientForTool = session;
                    serverUuid = mcpServerUuid;
                    toolToClient[name] = session;
                    toolToServerUuid[name] = mcpServerUuid;
                    break;
                  }

                  cursor = result.nextCursor;
                  hasMore = !!result.nextCursor;
                }

                if (foundTool) {
                  break;
                }
              } catch (error) {
                logger.error(
                  `Error checking tools for server ${serverName}:`,
                  error,
                );
                continue;
              }
            }
          }
        }
      } catch (error) {
        logger.error(`Error dynamically finding tool ${name}:`, error);
      }
    }

    if (!clientForTool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    if (!serverUuid) {
      throw new Error(`Server UUID not found for tool: ${name}`);
    }

    const abortController = new AbortController();

    // Get configurable timeout values
    const resetTimeoutOnProgress =
      await configService.getMcpResetTimeoutOnProgress();
    // Per-namespace timeout: honor MCP_TIMEOUT_<NS>_MS override, else global.
    const timeout = await configService.getMcpTimeoutForNamespace(
      namespace?.name || "",
    );
    const maxTotalTimeout = await configService.getMcpMaxTotalTimeout();

    const mcpRequestOptions: RequestOptions = {
      signal: abortController.signal,
      resetTimeoutOnProgress,
      timeout,
      maxTotalTimeout,
    };

    // Fetch the backend result with a PERMISSIVE schema (z.unknown) so the SDK
    // returns the raw payload instead of hard-failing -32602 on a malformed
    // `content` shape during validation. We normalize to the SDK shape after,
    // and only then validate — so a backend's malformed output never becomes a
    // client-facing error.
    const callOnce = async (
      session: ConnectedClient,
    ): Promise<CallToolResult> => {
      const raw = await session.client.request(
        {
          method: "tools/call",
          params: {
            name: originalToolName,
            arguments: args || {},
            _meta: request.params._meta,
          },
        },
        z.unknown(),
        mcpRequestOptions,
      );
      // Normalize the backend's CallToolResult so a non-conforming shape never
      // becomes a client-facing -32602 (zod hard-fail on the SDK shape). A
      // backend's malformed output is a reason to degrade, not to break the
      // call for the client.
      const result = normalizeCallToolResult(raw as CallToolResult, serverUuid);
      // Validate the normalized result: if it STILL doesn't conform (e.g. the
      // backend returned a fundamentally non-result object), surface a clean
      // retryable error rather than a raw zod dump.
      const parsed = CallToolResultSchema.safeParse(result);
      if (!parsed.success) {
        logger.error(
          `[call-tool] backend ${serverUuid} returned an unshapable CallToolResult for tool "${name}"; returning clean error`,
        );
        throw new Error(
          `Backend ${serverUuid} returned an invalid tools/call result for "${name}"`,
        );
      }
      return parsed.data;
    };

    try {
      // Circuit breaker: a successful call resets the backend's failure count.
      circuitBreaker.onSuccess(serverUuid);
      return await callOnce(clientForTool);
    } catch (error) {
      // Circuit breaker: a failed/timed-out call counts toward tripping.
      circuitBreaker.onFailure(serverUuid);

      if (!isBackendSessionLostError(error)) {
        logger.error(
          `Error calling tool "${name}" through ${
            clientForTool.client.getServerVersion()?.name || "unknown"
          }:`,
          error,
        );
        throw error;
      }

      // Circuit breaker: a tripped backend must not be spawned into on every
      // call. Surface a clean retryable error; the breaker's half-open probe
      // lets a real request through once the cooldown elapses.
      if (circuitBreaker.isOpen(serverUuid)) {
        throw new Error(
          `Backend server ${serverUuid} is circuit-open; skipping re-initialize for tool "${name}"`,
        );
      }

      logger.warn(
        `Backend reported session lost for server ${serverUuid} on tool "${name}"; invalidating pool and retrying once.`,
      );

      await mcpServerPool.invalidateServerConnection(sessionId, serverUuid);
      delete toolToClient[name];

      const serverParamsMap = await getMcpServers(
        namespaceUuid,
        includeInactiveServers,
      );
      const params = serverParamsMap[serverUuid];
      if (!params) {
        throw new Error(
          `Cannot re-initialize session: server ${serverUuid} no longer present in namespace ${namespaceUuid}`,
        );
      }

      const freshSession = await mcpServerPool.getSession(
        sessionId,
        serverUuid,
        params,
        namespaceUuid,
      );
      if (!freshSession) {
        throw new Error(
          `Failed to re-initialize session for server ${serverUuid} after backend session loss`,
        );
      }

      toolToClient[name] = freshSession;

      try {
        return (await callOnce(freshSession)) as CallToolResult;
      } catch (retryError) {
        logger.error(
          `Error calling tool "${name}" through ${
            freshSession.client.getServerVersion()?.name || "unknown"
          } after session re-initialize:`,
          retryError,
        );
        // The retry's fresh spawn is registered in the pool but will never be
        // recycled or evicted if the caller already gave up (its request timed
        // out while we awaited the fresh connect). Invalidate + kill it so a
        // failed recovery does not leak a spawned backend process forever
        // (the pid-47 orphan pileup that pushed the container to 8.45GB/8GB).
        // The invalidation cascades across every slot for this serverUuid and
        // is idempotent — safe if another request already adopted this session.
        await mcpServerPool
          .invalidateServerConnection(sessionId, serverUuid)
          .catch((invalidateError) => {
            logger.error(
              `Error cleaning up leaked fresh session for server ${serverUuid} after failed re-initialize:`,
              invalidateError,
            );
          });
        throw retryError;
      }
    }
  };

  // Compose middleware with handlers - this is the Express-like functional approach
  const listToolsWithMiddleware = compose(
    createToolOverridesListToolsMiddleware({
      cacheEnabled: true,
      persistentCacheOnListTools: true,
    }),
    createFilterListToolsMiddleware({ cacheEnabled: true }),
    // Add more middleware here as needed
    // createLoggingMiddleware(),
    // createRateLimitingMiddleware(),
  )(originalListToolsHandler);

  const callToolWithMiddleware = compose(
    createAuditCallToolMiddleware({ resolveToolIdentity }),
    createFilterCallToolMiddleware({
      cacheEnabled: true,
      customErrorMessage: (toolName, reason) =>
        `Access denied to tool "${toolName}": ${reason}`,
    }),
    createToolOverridesCallToolMiddleware({ cacheEnabled: true }),
    // Add more middleware here as needed
    // createAuthorizationMiddleware(),
  )(originalCallToolHandler);

  // Set up the handlers with middleware
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const result = await listToolsWithMiddleware(request, handlerContext);
    const adminContext = getAdminToolsContext(handlerContext.sessionId);

    if (adminContext?.enabled && adminContext.userId) {
      result.tools.push(...getAdminToolsForMcp());
    }

    return result;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (isExposedAdminToolName(request.params.name)) {
      const adminContext = getAdminToolsContext(handlerContext.sessionId);
      if (!adminContext?.enabled || !adminContext.userId) {
        throw new Error(
          `Access denied to MetaMCP admin tool: ${request.params.name}`,
        );
      }

      return executeAdminTool(
        request.params.name,
        adminContext.userId,
        request.params.arguments,
      );
    }

    return await callToolWithMiddleware(request, handlerContext);
  });

  // Get Prompt Handler
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    const clientForPrompt = promptToClient[name];

    if (!clientForPrompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    try {
      // Parse the prompt name using shared utility
      const parsed = parseToolName(name);
      if (!parsed) {
        throw new Error(`Invalid prompt name format: ${name}`);
      }

      const promptName = parsed.originalToolName;
      const response = await clientForPrompt.client.request(
        {
          method: "prompts/get",
          params: {
            name: promptName,
            arguments: request.params.arguments || {},
            _meta: request.params._meta,
          },
        },
        GetPromptResultSchema,
      );

      return response;
    } catch (error) {
      logger.error(
        `Error getting prompt through ${
          clientForPrompt.client.getServerVersion()?.name
        }:`,
        error,
      );
      throw error;
    }
  });

  // List Prompts Handler
  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    const serverParams = await getMcpServers(
      namespaceUuid,
      includeInactiveServers,
    );
    const allPrompts: ListPromptsResult["prompts"] = [];
    const failedServers: string[] = [];

    // Extract forwarded headers from client request for servers that need them
    const forwardedHeadersByServer = handlerContext.clientRequestHeaders
      ? extractForwardedHeaders(
          handlerContext.clientRequestHeaders,
          serverParams,
        )
      : {};

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // Filter out self-referencing servers before processing
    const validPromptServers = Object.entries(serverParams).filter(
      ([uuid, params]) => {
        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(uuid)) {
          logger.info(
            `Skipping already visited server in prompts: ${params.name || uuid}`,
          );
          return false;
        }

        // Check if this server is the same instance to prevent self-referencing
        if (isSameServerInstance(params, uuid)) {
          logger.info(
            `Skipping self-referencing server in prompts: ${params.name || uuid}`,
          );
          return false;
        }

        // Mark this server as visited
        visitedServers.add(uuid);
        return true;
      },
    );

    await Promise.allSettled(
      validPromptServers.map(async ([uuid, params]) => {
        // Merge forwarded headers into server params for this session
        const effectiveParams = forwardedHeadersByServer[uuid]
          ? {
              ...params,
              headers: mergeHeaders(
                params.headers,
                forwardedHeadersByServer[uuid],
              ),
            }
          : params;

        const session = await mcpServerPool.getSession(
          sessionId,
          uuid,
          effectiveParams,
          namespaceUuid,
        );
        if (!session) {
          logger.error(
            `prompts/list: no session available for server ${params.name || uuid} — excluded from namespace response (error state, connection cap, or backend unreachable)`,
          );
          failedServers.push(params.name || uuid);
          return;
        }

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client.getServerVersion();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${namespaceUuid}`;

        if (actualServerName === ourServerName) {
          logger.info(
            `Skipping self-referencing MetaMCP server in prompts: "${actualServerName}"`,
          );
          return;
        }

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.prompts) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        try {
          let activeSession = session;
          const result = await requestWithSessionRecovery({
            pool: mcpServerPool,
            sessionId,
            serverUuid: uuid,
            params,
            namespaceUuid,
            operation: "prompts/list",
            serverName,
            session,
            attempt: (active) =>
              active.client.request(
                {
                  method: "prompts/list",
                  params: {
                    cursor: request.params?.cursor,
                    _meta: request.params?._meta,
                  },
                },
                ListPromptsResultSchema,
              ),
            onFreshSession: (fresh) => {
              activeSession = fresh;
            },
          });

          if (result.prompts) {
            const promptsWithSource = result.prompts.map((prompt) => {
              const promptName = `${sanitizeName(serverName)}__${prompt.name}`;
              promptToClient[promptName] = activeSession;
              return {
                ...prompt,
                name: promptName,
                description: prompt.description || "",
              };
            });
            allPrompts.push(...promptsWithSource);
          }
        } catch (error) {
          logger.error(`Error fetching prompts from: ${serverName}`, error);
          failedServers.push(serverName || uuid);
        }
      }),
    );

    if (failedServers.length > 0) {
      logger.error(
        `prompts/list DEGRADED for namespace ${namespaceUuid}: ${failedServers.length} backend server(s) failed (${failedServers.join(", ")}); returning ${allPrompts.length} prompts`,
      );
    }

    return {
      prompts: allPrompts,
      nextCursor: request.params?.cursor,
    };
  });

  // List Resources Handler
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const serverParams = await getMcpServers(
      namespaceUuid,
      includeInactiveServers,
    );
    const allResources: ListResourcesResult["resources"] = [];
    const failedServers: string[] = [];

    // Extract forwarded headers from client request for servers that need them
    const forwardedHeadersByServer = handlerContext.clientRequestHeaders
      ? extractForwardedHeaders(
          handlerContext.clientRequestHeaders,
          serverParams,
        )
      : {};

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // Filter out self-referencing servers before processing
    const validResourceServers = Object.entries(serverParams).filter(
      ([uuid, params]) => {
        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(uuid)) {
          logger.info(
            `Skipping already visited server in resources: ${params.name || uuid}`,
          );
          return false;
        }

        // Check if this server is the same instance to prevent self-referencing
        if (isSameServerInstance(params, uuid)) {
          logger.info(
            `Skipping self-referencing server in resources: ${params.name || uuid}`,
          );
          return false;
        }

        // Mark this server as visited
        visitedServers.add(uuid);
        return true;
      },
    );

    await Promise.allSettled(
      validResourceServers.map(async ([uuid, params]) => {
        // Merge forwarded headers into server params for this session
        const effectiveParams = forwardedHeadersByServer[uuid]
          ? {
              ...params,
              headers: mergeHeaders(
                params.headers,
                forwardedHeadersByServer[uuid],
              ),
            }
          : params;

        const session = await mcpServerPool.getSession(
          sessionId,
          uuid,
          effectiveParams,
          namespaceUuid,
        );
        if (!session) {
          logger.error(
            `resources/list: no session available for server ${params.name || uuid} — excluded from namespace response (error state, connection cap, or backend unreachable)`,
          );
          failedServers.push(params.name || uuid);
          return;
        }

        // Now check for self-referencing using the actual MCP server name
        const serverVersion = session.client.getServerVersion();
        const actualServerName = serverVersion?.name || params.name || "";
        const ourServerName = `metamcp-unified-${namespaceUuid}`;

        if (actualServerName === ourServerName) {
          logger.info(
            `Skipping self-referencing MetaMCP server in resources: "${actualServerName}"`,
          );
          return;
        }

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.resources) return;

        // Use name assigned by user, fallback to name from server
        const serverName =
          params.name || session.client.getServerVersion()?.name || "";
        try {
          let activeSession = session;
          const result = await requestWithSessionRecovery({
            pool: mcpServerPool,
            sessionId,
            serverUuid: uuid,
            params,
            namespaceUuid,
            operation: "resources/list",
            serverName,
            session,
            attempt: (active) =>
              active.client.request(
                {
                  method: "resources/list",
                  params: {
                    cursor: request.params?.cursor,
                    _meta: request.params?._meta,
                  },
                },
                ListResourcesResultSchema,
              ),
            onFreshSession: (fresh) => {
              activeSession = fresh;
            },
          });

          if (result.resources) {
            const resourcesWithSource = result.resources.map((resource) => {
              resourceToClient[resource.uri] = activeSession;
              return {
                ...resource,
                name: resource.name || "",
              };
            });
            allResources.push(...resourcesWithSource);
          }
        } catch (error) {
          logger.error(`Error fetching resources from: ${serverName}`, error);
          failedServers.push(serverName || uuid);
        }
      }),
    );

    if (failedServers.length > 0) {
      logger.error(
        `resources/list DEGRADED for namespace ${namespaceUuid}: ${failedServers.length} backend server(s) failed (${failedServers.join(", ")}); returning ${allResources.length} resources`,
      );
    }

    return {
      resources: allResources,
      nextCursor: request.params?.cursor,
    };
  });

  // Read Resource Handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const clientForResource = resourceToClient[uri];

    if (!clientForResource) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    try {
      return await clientForResource.client.request(
        {
          method: "resources/read",
          params: {
            uri,
            _meta: request.params._meta,
          },
        },
        ReadResourceResultSchema,
      );
    } catch (error) {
      logger.error(
        `Error reading resource through ${
          clientForResource.client.getServerVersion()?.name
        }:`,
        error,
      );
      throw error;
    }
  });

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (request) => {
      const serverParams = await getMcpServers(
        namespaceUuid,
        includeInactiveServers,
      );
      const allTemplates: ResourceTemplate[] = [];
      const failedServers: string[] = [];

      // Track visited servers to detect circular references - reset on each call
      const visitedServers = new Set<string>();

      // Filter out self-referencing servers before processing
      // Extract forwarded headers from client request for servers that need them
      const forwardedHeadersByServer = handlerContext.clientRequestHeaders
        ? extractForwardedHeaders(
            handlerContext.clientRequestHeaders,
            serverParams,
          )
        : {};

      const validTemplateServers = Object.entries(serverParams).filter(
        ([uuid, params]) => {
          // Skip if we've already visited this server to prevent circular references
          if (visitedServers.has(uuid)) {
            logger.info(
              `Skipping already visited server in resource templates: ${params.name || uuid}`,
            );
            return false;
          }

          // Check if this server is the same instance to prevent self-referencing
          if (isSameServerInstance(params, uuid)) {
            logger.info(
              `Skipping self-referencing server in resource templates: ${params.name || uuid}`,
            );
            return false;
          }

          // Mark this server as visited
          visitedServers.add(uuid);
          return true;
        },
      );

      await Promise.allSettled(
        validTemplateServers.map(async ([uuid, params]) => {
          // Merge forwarded headers into server params for this session
          const effectiveParams = forwardedHeadersByServer[uuid]
            ? {
                ...params,
                headers: mergeHeaders(
                  params.headers,
                  forwardedHeadersByServer[uuid],
                ),
              }
            : params;

          const session = await mcpServerPool.getSession(
            sessionId,
            uuid,
            effectiveParams,
            namespaceUuid,
          );
          if (!session) {
            logger.error(
              `resources/templates/list: no session available for server ${params.name || uuid} — excluded from namespace response (error state, connection cap, or backend unreachable)`,
            );
            failedServers.push(params.name || uuid);
            return;
          }

          // Now check for self-referencing using the actual MCP server name
          const serverVersion = session.client.getServerVersion();
          const actualServerName = serverVersion?.name || params.name || "";
          const ourServerName = `metamcp-unified-${namespaceUuid}`;

          if (actualServerName === ourServerName) {
            logger.info(
              `Skipping self-referencing MetaMCP server in resource templates: "${actualServerName}"`,
            );
            return;
          }

          const capabilities = session.client.getServerCapabilities();
          if (!capabilities?.resources) return;

          const serverName =
            params.name || session.client.getServerVersion()?.name || "";

          try {
            // No per-client map to repoint here (templates aren't keyed to a
            // client), so onFreshSession is omitted — the recovery still
            // invalidates + retries on the fresh session.
            const result = await requestWithSessionRecovery({
              pool: mcpServerPool,
              sessionId,
              serverUuid: uuid,
              params,
              namespaceUuid,
              operation: "resources/templates/list",
              serverName,
              session,
              attempt: (active) =>
                active.client.request(
                  {
                    method: "resources/templates/list",
                    params: {
                      cursor: request.params?.cursor,
                      _meta: request.params?._meta,
                    },
                  },
                  ListResourceTemplatesResultSchema,
                ),
            });

            if (result.resourceTemplates) {
              const templatesWithSource = result.resourceTemplates.map(
                (template) => ({
                  ...template,
                  name: template.name || "",
                }),
              );
              allTemplates.push(...templatesWithSource);
            }
          } catch (error) {
            logger.error(
              `Error fetching resource templates from: ${serverName}`,
              error,
            );
            failedServers.push(serverName || uuid);
            return;
          }
        }),
      );

      if (failedServers.length > 0) {
        logger.error(
          `resources/templates/list DEGRADED for namespace ${namespaceUuid}: ${failedServers.length} backend server(s) failed (${failedServers.join(", ")}); returning ${allTemplates.length} templates`,
        );
      }

      return {
        resourceTemplates: allTemplates,
        nextCursor: request.params?.cursor,
      };
    },
  );

  const cleanup = async () => {
    // Cleanup is now handled by the pool
    await mcpServerPool.cleanupSession(sessionId);
  };

  return { server, cleanup, internalSessionId: sessionId };
};
