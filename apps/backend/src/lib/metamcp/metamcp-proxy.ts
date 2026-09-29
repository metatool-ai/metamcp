import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  CallToolResult,
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
import type { ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

import { namespacesRepository } from "../../db/repositories/namespaces.repo";
import { toolsRepository } from "../../db/repositories/tools.repo";
import { accessService } from "../access/access.service";
import { isServerAllowedInNamespace } from "../access/namespace-composition";
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
import { serverSnapshots } from "./server-snapshots";
import { isBackendSessionLostError } from "./session-error";
import { parseToolName } from "./tool-name-parser";
import { toolsSyncCache } from "./tools-sync-cache";
import { sanitizeName } from "./utils";

/**
 * Filter out tools that are overrides of existing tools to prevent duplicates in database
 * Uses the existing tool overrides cache for optimal performance
 */
async function filterOutOverrideTools(
  tools: Tool[],
  namespaceUuid: string,
  serverName: string,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) {
    return tools;
  }

  const filteredTools: Tool[] = [];

  await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        // Check if this tool name is actually an override name for an existing tool
        // by using the existing mapOverrideNameToOriginal function
        const fullToolName = `${sanitizeName(serverName)}__${tool.name}`;
        const originalName = await mapOverrideNameToOriginal(
          fullToolName,
          namespaceUuid,
          true, // use cache
        );

        // If the original name is different from the current name,
        // this tool is an override and should be filtered out
        if (originalName !== fullToolName) {
          // This is an override, skip it (don't save to database)
          return;
        }

        // This is not an override, include it
        filteredTools.push(tool);
      } catch (error) {
        logger.error(
          `Error checking if tool ${tool.name} is an override:`,
          error,
        );
        // On error, include the tool (fail-safe behavior)
        filteredTools.push(tool);
      }
    }),
  );

  return filteredTools;
}

/** Upper bound on the pages read from one upstream list (tools/list). */
const MAX_UPSTREAM_PAGES = 100;

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
  const promptToServerUuid: Record<string, string> = {};
  const resourceToClient: Record<string, ConnectedClient> = {};
  const resourceToServerUuid: Record<string, string> = {};

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

  // Every request handler runs through this: while a request runs, the pool
  // never releases the connections of this session as unused.
  const tracked =
    <Req, Res>(handler: (request: Req) => Promise<Res>) =>
    (request: Req): Promise<Res> =>
      mcpServerPool.trackRequest(sessionId, () => handler(request));

  // The routing tables (toolToClient...) remember the pooled connection that
  // listed each tool, prompt and resource. The pool may have released it
  // since (MCP_CONNECTION_IDLE_TTL): calls go through the connection this
  // session holds now, opened again when needed.
  const liveClientFor = async (
    serverUuid: string,
  ): Promise<ConnectedClient | undefined> => {
    const held = mcpServerPool.getActiveConnection(sessionId, serverUuid);
    if (held) {
      return held;
    }

    const serverParams = await getMcpServers(
      namespaceUuid,
      includeInactiveServers,
    );
    const params = serverParams[serverUuid];
    if (!params) {
      return undefined;
    }
    const forwarded = clientRequestHeaders
      ? extractForwardedHeaders(clientRequestHeaders, {
          [serverUuid]: params,
        })[serverUuid]
      : undefined;
    const client = await mcpServerPool.getSession(
      sessionId,
      serverUuid,
      forwarded
        ? { ...params, headers: mergeHeaders(params.headers, forwarded) }
        : params,
      namespaceUuid,
    );
    if (client) {
      serverSnapshots.refreshInBackground(params, client);
    }
    return client;
  };

  // Servers this session holds no connection to and whose snapshot shows no
  // `capability`: the prompts / resources lists skip them instead of
  // starting them.
  const serversWithout = async (
    serverParams: Record<string, ServerParameters>,
    capability: "prompts" | "resources",
  ): Promise<Set<string>> => {
    const held = mcpServerPool.getSessionConnections(sessionId) ?? {};
    const snapshots = await serverSnapshots.fresh(
      Object.entries(serverParams)
        .filter(
          ([uuid, params]) => !held[uuid] && serverSnapshots.canUse(params),
        )
        .map(([uuid]) => uuid),
    );
    return new Set(
      [...snapshots]
        .filter(([, snapshot]) => !snapshot.capabilities[capability])
        .map(([uuid]) => uuid),
    );
  };

  // Original List Tools Handler
  const originalListToolsHandler: ListToolsHandler = async (
    request,
    context,
  ) => {
    console.log(
      "[DEBUG-TOOLS] 🔍 tools/list called for namespace:",
      namespaceUuid,
    );
    const startTime = performance.now();
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );

    // Extract forwarded headers from client request for servers that need them
    const forwardedHeadersByServer = context.clientRequestHeaders
      ? extractForwardedHeaders(context.clientRequestHeaders, serverParams)
      : {};

    const allTools: Tool[] = [];
    // Prefixed tools per server, merged once every server has answered
    const toolCandidates: Array<{
      tool: Tool;
      serverUuid: string;
      // Undefined when listed from the server's snapshot
      session?: ConnectedClient;
    }> = [];

    // Servers that should have contributed tools but failed even after the
    // recovery retry (or had no session at all). Drives the degraded-response
    // tripwire after the fan-out — a swallowed failure returns a "successful"
    // 0-tool namespace and nobody notices until a manual restart.
    const failedServers: string[] = [];

    // Track visited servers to detect circular references - reset on each call
    const visitedServers = new Set<string>();

    // We'll filter servers during processing after getting sessions to check actual MCP server names
    const allServerEntries = Object.entries(serverParams);

    console.log(
      `[DEBUG-TOOLS] 📋 Processing ${allServerEntries.length} servers`,
    );

    // Servers this session holds no connection to answer from the tools they
    // listed last (MCP_TOOLS_CACHE_TTL), without being started: they start
    // for a call.
    const heldConnections =
      mcpServerPool.getSessionConnections(context.sessionId) ?? {};
    const snapshots = await serverSnapshots.fresh(
      allServerEntries
        .filter(
          ([uuid, params]) =>
            !heldConnections[uuid] && serverSnapshots.canUse(params),
        )
        .map(([uuid]) => uuid),
    );

    // Cold-start warmup: if pool has 0 idle + 0 active sessions but servers
    // exist in DB, trigger a blocking warmup before tools/list responds.
    // This prevents 0-tool responses after idle timeout expires all connections.
    // Warm pool only: otherwise getSession() below opens the connections.
    const poolStatus = mcpServerPool.getPoolStatus();
    if (
      mcpServerPool.isWarm &&
      poolStatus.idle === 0 &&
      poolStatus.active === 0 &&
      allServerEntries.length > 0
    ) {
      console.log(
        `[DEBUG-TOOLS] ⚠️ Cold start: 0 idle, 0 active sessions but ${allServerEntries.length} servers registered. Warming up...`,
      );
      for (const [uuid] of allServerEntries) {
        await mcpServerPool.resetServerErrorState(uuid);
      }
      await mcpServerPool.ensureIdleSessions(serverParams, namespaceUuid);
      const afterStatus = mcpServerPool.getPoolStatus();
      console.log(
        `[DEBUG-TOOLS] ✅ Pool warmup complete: ${afterStatus.idle} idle, ${afterStatus.active} active`,
      );
    }

    await Promise.allSettled(
      allServerEntries.map(async ([mcpServerUuid, params]) => {
        console.log(`[DEBUG-TOOLS] 🔧 Server: ${params.name || mcpServerUuid}`);

        // Skip if we've already visited this server to prevent circular references
        if (visitedServers.has(mcpServerUuid)) {
          console.log(
            `[DEBUG-TOOLS] ⏭️  Skipping already visited: ${params.name}`,
          );
          return;
        }

        const snapshot = snapshots.get(mcpServerUuid);
        if (snapshot) {
          if (
            snapshot.serverInfo?.name === `metamcp-unified-${namespaceUuid}` ||
            isSameServerInstance(params, mcpServerUuid)
          ) {
            return;
          }
          visitedServers.add(mcpServerUuid);
          if (!snapshot.capabilities.tools) return;
          const serverName = params.name || snapshot.serverInfo?.name || "";
          for (const tool of snapshot.tools) {
            toolCandidates.push({
              tool: {
                ...tool,
                name: `${sanitizeName(serverName)}__${tool.name}`,
              },
              serverUuid: mcpServerUuid,
            });
          }
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

        const session = await mcpServerPool.getSession(
          context.sessionId,
          mcpServerUuid,
          effectiveParams,
          namespaceUuid,
        );
        if (!session) {
          console.log(`[DEBUG-TOOLS] ❌ No session for: ${params.name}`);
          // No pooled session and the pool couldn't create one — server is
          // ERROR-gated, connection-capped, or unreachable. Error level: this
          // server is silently missing from the namespace's tool surface
          // until the pool recovers.
          logger.error(
            `tools/list: no session available for server ${params.name || mcpServerUuid} — excluded from namespace response (error state, connection cap, or backend unreachable)`,
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

          // Paginated tool discovery - load all pages automatically
          const fetchAllToolPages = async (
            active: ConnectedClient,
          ): Promise<Tool[]> => {
            const pages: Tool[] = [];
            let cursor: string | undefined = undefined;
            let hasMore = true;
            const seenCursors = new Set<string>();

            while (hasMore && seenCursors.size < MAX_UPSTREAM_PAGES) {
              const result: ListToolsResult = await active.client.request(
                {
                  method: "tools/list",
                  params: {
                    cursor: cursor,
                    _meta: request.params?._meta,
                  },
                },
                ListToolsResultSchema,
              );

              if (result.tools && result.tools.length > 0) {
                pages.push(...result.tools);
              }

              cursor = result.nextCursor;
              // A server repeating its cursor would loop forever
              hasMore = !!cursor && !seenCursors.has(cursor);
              if (cursor) seenCursors.add(cursor);
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

          console.log(
            `[DEBUG-TOOLS] ⏱️  Fetched ${allServerTools.length} tools from ${serverName} in ${(performance.now() - toolFetchStart).toFixed(2)}ms`,
          );

          // Later sessions are answered from it without starting the server
          void serverSnapshots.record(params, activeSession, allServerTools);

          // Save original tools to database (before middleware processing)
          // This ensures we only save the actual tool names, not override names
          // Filter out tools that are overrides of existing tools to prevent duplicates
          try {
            // PERFORMANCE OPTIMIZATION: Check hash FIRST to avoid expensive operations
            const hasChanged = toolsSyncCache.hasChanged(
              mcpServerUuid,
              allServerTools,
            );

            console.log(
              `[DEBUG-TOOLS] 🔍 Hash check for ${serverName}: ${hasChanged ? "CHANGED" : "UNCHANGED"}`,
            );

            if (hasChanged) {
              const toolsToSave = await filterOutOverrideTools(
                allServerTools,
                namespaceUuid,
                serverName,
              );

              if (toolsToSave.length > 0) {
                // Sync with cleanup
                // Tools come straight from the upstream server here (not
                // from a client), so no per-user check applies.
                await toolsRepository.syncTools({
                  tools: toolsToSave,
                  mcpServerUuid: mcpServerUuid,
                });

                // Update cache once stored (a failed write is retried)
                toolsSyncCache.update(mcpServerUuid, allServerTools);
              }
            }
          } catch (dbError) {
            logger.error(
              `Error syncing tools to database for server ${serverName}:`,
              dbError,
            );
          }

          // Use original tools for client response (middleware will be applied later)
          for (const tool of allServerTools) {
            toolCandidates.push({
              tool: {
                ...tool,
                name: `${sanitizeName(serverName)}__${tool.name}`,
                description: tool.description,
              },
              serverUuid: mcpServerUuid,
              session: activeSession,
            });
          }
        } catch (error) {
          logger.error(`Error fetching tools from: ${serverName}`, error);
          failedServers.push(serverName || mcpServerUuid);
        }
      }),
    );

    // Two servers of a namespace can yield the same prefixed name (servers
    // with the same name, e.g. a personal and an organisation "github"). A
    // name routes to one server only: the one with the smallest uuid, so the
    // choice does not depend on which server answered first.
    const toolOwners = new Map<string, string>();
    for (const { tool, serverUuid } of toolCandidates) {
      const owner = toolOwners.get(tool.name);
      if (owner === undefined || serverUuid < owner) {
        toolOwners.set(tool.name, serverUuid);
      }
    }
    const listedTools = new Set<string>();
    for (const { tool, serverUuid, session } of toolCandidates) {
      if (toolOwners.get(tool.name) !== serverUuid) {
        logger.warn(
          `tools/list: tool name ${tool.name} is exposed by several servers of namespace ${namespaceUuid}; server ${serverUuid} is ignored for it. Give the servers distinct names.`,
        );
        continue;
      }
      if (listedTools.has(tool.name)) continue;
      listedTools.add(tool.name);
      if (session) {
        toolToClient[tool.name] = session;
      } else {
        delete toolToClient[tool.name];
      }
      toolToServerUuid[tool.name] = serverUuid;
      allTools.push(tool);
    }

    const totalTime = performance.now() - startTime;
    console.log(
      `[DEBUG-TOOLS] ✅ tools/list completed in ${totalTime.toFixed(2)}ms, returning ${allTools.length} tools`,
    );

    // Degraded-response tripwire: a server that should have contributed tools
    // failed even after the recovery retry (or had no session). The response
    // is still returned (partial truth beats a hard error for the surviving
    // servers) but the failure must be loud enough for log-based monitoring.
    if (failedServers.length > 0) {
      logger.error(
        `tools/list DEGRADED for namespace ${namespaceUuid}: ${failedServers.length}/${allServerEntries.length} backend server(s) failed (${failedServers.join(", ")}); returning ${allTools.length} tools`,
      );
    }

    return { tools: allTools };
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
    if (!serverUuid) {
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

        // Find the server with the matching name prefix. Smallest uuid
        // first, like tools/list does when several servers share a name.
        const candidates = Object.entries(serverParams).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        for (const [mcpServerUuid, params] of candidates) {
          // Don't open connections to servers the tool name rules out
          if (params.name && sanitizeName(params.name) !== serverPrefix) {
            continue;
          }

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
                const seenCursors = new Set<string>();

                while (
                  hasMore &&
                  !foundTool &&
                  seenCursors.size < MAX_UPSTREAM_PAGES
                ) {
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
                  hasMore = !!cursor && !seenCursors.has(cursor);
                  if (cursor) seenCursors.add(cursor);
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

    if (!serverUuid) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // The routing table is filled by tools/list: re-check that the server
    // is still part of what the namespace may expose (revoked shares).
    if (!(await isServerAllowedInNamespace(namespaceUuid, serverUuid))) {
      delete toolToClient[name];
      delete toolToServerUuid[name];
      throw new Error(`Unknown tool: ${name}`);
    }

    const liveClient = await liveClientFor(serverUuid);
    if (!liveClient) {
      throw new Error(`The server of tool ${name} is not available`);
    }
    clientForTool = liveClient;
    toolToClient[name] = liveClient;

    const abortController = new AbortController();

    // Get configurable timeout values
    const resetTimeoutOnProgress =
      await configService.getMcpResetTimeoutOnProgress();
    const timeout = await configService.getMcpTimeout();
    const maxTotalTimeout = await configService.getMcpMaxTotalTimeout();

    const mcpRequestOptions: RequestOptions = {
      signal: abortController.signal,
      resetTimeoutOnProgress,
      timeout,
      maxTotalTimeout,
    };

    const callOnce = (session: ConnectedClient) =>
      session.client.request(
        {
          method: "tools/call",
          params: {
            name: originalToolName,
            arguments: args || {},
            _meta: request.params._meta,
          },
        },
        CompatibilityCallToolResultSchema,
        mcpRequestOptions,
      );

    try {
      return (await callOnce(clientForTool)) as CallToolResult;
    } catch (error) {
      if (!isBackendSessionLostError(error)) {
        logger.error(
          `Error calling tool "${name}" through ${
            clientForTool.client.getServerVersion()?.name || "unknown"
          }:`,
          error,
        );
        throw error;
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
  server.setRequestHandler(
    ListToolsRequestSchema,
    tracked(async (request) => {
      const result = await listToolsWithMiddleware(request, handlerContext);
      const adminContext = getAdminToolsContext(handlerContext.sessionId);

      if (adminContext?.enabled && adminContext.userId) {
        // Re-resolved on every listing: tools reflect the caller's current role.
        const principal = await accessService.getPrincipal(adminContext.userId);
        if (principal) {
          result.tools.push(...getAdminToolsForMcp(principal));
        }
      }

      return result;
    }),
  );

  // Admin tool calls are audited like any other tool call.
  const callAdminToolWithAudit = createAuditCallToolMiddleware()(async (
    request,
  ) => {
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
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    tracked(async (request) => {
      if (isExposedAdminToolName(request.params.name)) {
        return await callAdminToolWithAudit(request, handlerContext);
      }

      return await callToolWithMiddleware(request, handlerContext);
    }),
  );

  // Get Prompt Handler
  server.setRequestHandler(
    GetPromptRequestSchema,
    tracked(async (request) => {
      const { name } = request.params;
      const promptServerUuid = promptToServerUuid[name];

      if (
        !promptToClient[name] ||
        !promptServerUuid ||
        !(await isServerAllowedInNamespace(namespaceUuid, promptServerUuid))
      ) {
        throw new Error(`Unknown prompt: ${name}`);
      }

      const clientForPrompt = await liveClientFor(promptServerUuid);
      if (!clientForPrompt) {
        throw new Error(`The server of prompt ${name} is not available`);
      }
      promptToClient[name] = clientForPrompt;

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
    }),
  );

  // List Prompts Handler
  server.setRequestHandler(
    ListPromptsRequestSchema,
    tracked(async (request) => {
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

      const withoutPrompts = await serversWithout(serverParams, "prompts");

      // Filter out self-referencing servers before processing
      const validPromptServers = Object.entries(serverParams).filter(
        ([uuid, params]) => {
          if (withoutPrompts.has(uuid)) {
            return false;
          }
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
                promptToServerUuid[promptName] = uuid;
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
        // Complete list: no further page
        prompts: allPrompts,
      };
    }),
  );

  // List Resources Handler
  server.setRequestHandler(
    ListResourcesRequestSchema,
    tracked(async (request) => {
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

      const withoutResources = await serversWithout(serverParams, "resources");

      // Filter out self-referencing servers before processing
      const validResourceServers = Object.entries(serverParams).filter(
        ([uuid, params]) => {
          if (withoutResources.has(uuid)) {
            return false;
          }
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
                resourceToServerUuid[resource.uri] = uuid;
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
        // Complete list: no further page
        resources: allResources,
      };
    }),
  );

  // Read Resource Handler
  server.setRequestHandler(
    ReadResourceRequestSchema,
    tracked(async (request) => {
      const { uri } = request.params;
      const resourceServerUuid = resourceToServerUuid[uri];

      if (
        !resourceToClient[uri] ||
        !resourceServerUuid ||
        !(await isServerAllowedInNamespace(namespaceUuid, resourceServerUuid))
      ) {
        throw new Error(`Unknown resource: ${uri}`);
      }

      const clientForResource = await liveClientFor(resourceServerUuid);
      if (!clientForResource) {
        throw new Error(`The server of resource ${uri} is not available`);
      }
      resourceToClient[uri] = clientForResource;

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
    }),
  );

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    tracked(async (request) => {
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

      const withoutResources = await serversWithout(serverParams, "resources");

      const validTemplateServers = Object.entries(serverParams).filter(
        ([uuid, params]) => {
          if (withoutResources.has(uuid)) {
            return false;
          }
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
        // Complete list: no further page
        resourceTemplates: allTemplates,
      };
    }),
  );

  const cleanup = async () => {
    // Cleanup is now handled by the pool
    await mcpServerPool.cleanupSession(sessionId);
  };

  return { server, cleanup, internalSessionId: sessionId };
};
