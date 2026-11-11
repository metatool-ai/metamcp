import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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

import logger from "@/utils/logger";

import { db } from "../../db";
import {
  mcpServersTable,
  namespaceToolMappingsTable,
  toolsTable,
} from "../../db/schema";
import { namespacesRepository } from "../../db/repositories/namespaces.repo";
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
} from "./metamcp-middleware/tool-overrides.functional";
import { isRecoverableBackendError } from "./session-error";
import { parseToolName } from "./tool-name-parser";
import { toolsSyncCache } from "./tools-sync-cache";
import { sanitizeName } from "./utils";

const namespaceDiscoveryRefreshes = new Map<string, number>();
const namespaceDiscoveryRefreshCooldownMs = Math.max(
  5_000,
  Number.parseInt(
    process.env.MCP_NAMESPACE_DISCOVERY_REFRESH_MS || "30000",
    10,
  ) || 30000,
);

const configuredToolListLimit = Number.parseInt(
  process.env.MCP_TOOLS_LIST_MAX_TOOLS || "1000",
  10,
);
const maxExposedTools = Number.isFinite(configuredToolListLimit)
  ? Math.max(1, Math.min(configuredToolListLimit, 1000))
  : 1000;

function limitToolsFairly(tools: Tool[], limit: number): Tool[] {
  if (tools.length <= limit) return tools;

  const groups = new Map<string, Tool[]>();
  for (const tool of tools) {
    const separator = tool.name.indexOf("__");
    const key = separator > 0 ? tool.name.slice(0, separator) : "_meta";
    groups.set(key, [...(groups.get(key) || []), tool]);
  }

  const queues = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, items]) => ({
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      index: 0,
    }));
  const selected: Tool[] = [];
  while (selected.length < limit) {
    let added = false;
    for (const queue of queues) {
      const tool = queue.items[queue.index];
      if (!tool) continue;
      selected.push(tool);
      queue.index += 1;
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Filter out override aliases before synchronizing canonical tools to the database.
 */
async function filterOutOverrideTools(
  tools: Tool[],
  namespaceUuid: string,
  serverName: string,
): Promise<Tool[]> {
  if (!tools || tools.length === 0) return tools;

  try {
    // Check all override names for this server in one query. The former
    // implementation issued one reverse-lookup query for every tool on a
    // cold cache, which was especially expensive during initial provisioning.
    const mappings = await db
      .select({
        originalName: toolsTable.name,
        overrideName: namespaceToolMappingsTable.override_name,
      })
      .from(namespaceToolMappingsTable)
      .innerJoin(
        toolsTable,
        eq(toolsTable.uuid, namespaceToolMappingsTable.tool_uuid),
      )
      .innerJoin(
        mcpServersTable,
        eq(mcpServersTable.uuid, namespaceToolMappingsTable.mcp_server_uuid),
      )
      .where(
        and(
          eq(namespaceToolMappingsTable.namespace_uuid, namespaceUuid),
          eq(mcpServersTable.name, sanitizeName(serverName)),
        ),
      );

    const overrideNames = new Set(
      mappings
        .filter(
          (mapping) =>
            !!mapping.overrideName &&
            mapping.overrideName !== mapping.originalName,
        )
        .map((mapping) => mapping.overrideName as string),
    );
    return tools.filter((tool) => !overrideNames.has(tool.name));
  } catch (error) {
    logger.error(
      "Error checking tool overrides for server " + serverName + ":",
      error,
    );
    // Preserve the existing fail-safe behavior: keep tools if lookup fails.
    return tools;
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
    const startTime = performance.now();
    const serverParams = await getMcpServers(
      context.namespaceUuid,
      includeInactiveServers,
    );
    const serverEntries = Object.entries(serverParams);
    const serverNameByUuid = new Map(
      serverEntries.map(([uuid, params]) => [
        uuid,
        sanitizeName(params.name || uuid),
      ]),
    );

    // Serve the last successfully discovered tool definitions from Postgres.
    // Listing tools must not require opening every upstream backend connection.
    const persistedTools = serverEntries.length
      ? await db
          .select({
            name: toolsTable.name,
            description: toolsTable.description,
            toolSchema: toolsTable.toolSchema,
            mcpServerUuid: toolsTable.mcp_server_uuid,
          })
          .from(toolsTable)
          .where(
            inArray(
              toolsTable.mcp_server_uuid,
              serverEntries.map(([uuid]) => uuid),
            ),
          )
      : [];

    const allTools: Tool[] = persistedTools.map((stored) => {
      const toolName = `${serverNameByUuid.get(stored.mcpServerUuid) || stored.mcpServerUuid}__${stored.name}`;
      toolToServerUuid[toolName] = stored.mcpServerUuid;
      return {
        name: toolName,
        description: stored.description || "",
        inputSchema: stored.toolSchema,
      } as Tool;
    });

    // Refresh discovery asynchronously. A slow or unavailable backend cannot
    // hold up this tools/list response; concurrent requests share the cooldown.
    const lastRefresh = namespaceDiscoveryRefreshes.get(namespaceUuid) || 0;
    if (Date.now() - lastRefresh >= namespaceDiscoveryRefreshCooldownMs) {
      namespaceDiscoveryRefreshes.set(namespaceUuid, Date.now());
      void (async () => {
        const forwardedHeadersByServer = context.clientRequestHeaders
          ? extractForwardedHeaders(context.clientRequestHeaders, serverParams)
          : {};
        await Promise.allSettled(
          serverEntries.map(async ([serverUuid, params]) => {
            if (isSameServerInstance(params, serverUuid)) return;
            const effectiveParams = forwardedHeadersByServer[serverUuid]
              ? {
                  ...params,
                  headers: mergeHeaders(
                    params.headers,
                    forwardedHeadersByServer[serverUuid],
                  ),
                }
              : params;
            try {
              const session = await withTimeout(
                mcpServerPool.getSession(
                  context.sessionId,
                  serverUuid,
                  effectiveParams,
                  namespaceUuid,
                ),
                10_000,
                "Backend discovery connection timed out after 10s",
              );
              if (!session || !session.client.getServerCapabilities()?.tools)
                return;
              const serverName =
                params.name || session.client.getServerVersion()?.name || "";
              const discovered: Tool[] = [];
              let cursor: string | undefined;
              do {
                const result: ListToolsResult = await withTimeout(
                  session.client.request(
                    { method: "tools/list", params: { cursor } },
                    ListToolsResultSchema,
                  ),
                  10_000,
                  "Backend tools/list timed out after 10s",
                );
                discovered.push(...(result.tools || []));
                cursor = result.nextCursor;
              } while (cursor);
              const names = discovered.map((tool) => tool.name);
              if (toolsSyncCache.hasChanged(serverUuid, names)) {
                const toolsToSave = await filterOutOverrideTools(
                  discovered,
                  namespaceUuid,
                  serverName,
                );
                if (toolsToSave.length) {
                  const sync = await toolsImplementations.sync({
                    tools: toolsToSave,
                    mcpServerUuid: serverUuid,
                  });
                  if (sync.success) toolsSyncCache.update(serverUuid, names);
                }
              }
            } catch (error) {
              logger.warn(
                `Background tool discovery failed for ${params.name || serverUuid}:`,
                error,
              );
            }
          }),
        );
      })().catch((error) =>
        logger.error(
          `Background discovery failed for namespace ${namespaceUuid}:`,
          error,
        ),
      );
    }

    logger.info(
      `tools/list served ${allTools.length} persisted tools for namespace ${namespaceUuid} in ${(performance.now() - startTime).toFixed(2)}ms; background refresh ${Date.now() - lastRefresh >= namespaceDiscoveryRefreshCooldownMs ? "scheduled" : "cooldown"}`,
    );
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
          // Resolve by the configured namespace name first. Never connect to
          // unrelated backends while searching for a tool's owning server.
          if (sanitizeName(params.name || mcpServerUuid) !== serverPrefix)
            continue;

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
                // This path runs when the per-session tool map is absent (for
                // example, after a client reconnect). It must use the same
                // invalidate/reconnect/retry path as normal tools/list; using
                // the cached session directly turned a stale backend session
                // into a false "Unknown tool" response.
                let activeSession = session;
                const foundTool = await requestWithSessionRecovery({
                  pool: mcpServerPool,
                  sessionId: context.sessionId,
                  serverUuid: mcpServerUuid,
                  params: effectiveParams,
                  namespaceUuid,
                  operation: "tools/list (dynamic tool lookup)",
                  serverName,
                  session,
                  attempt: async (active) => {
                    let cursor: string | undefined;
                    let hasMore = true;
                    while (hasMore) {
                      const result: ListToolsResult =
                        await active.client.request(
                          {
                            method: "tools/list",
                            params: { cursor },
                          },
                          ListToolsResultSchema,
                        );
                      if (
                        result.tools?.some(
                          (tool: Tool) => tool.name === originalToolName,
                        )
                      ) {
                        return true;
                      }
                      cursor = result.nextCursor;
                      hasMore = !!result.nextCursor;
                    }
                    return false;
                  },
                  onFreshSession: (fresh) => {
                    activeSession = fresh;
                  },
                });

                if (foundTool) {
                  clientForTool = activeSession;
                  serverUuid = mcpServerUuid;
                  toolToClient[name] = activeSession;
                  toolToServerUuid[name] = mcpServerUuid;
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
      if (!isRecoverableBackendError(error)) {
        logger.error(
          `Error calling tool "${name}" through ${
            clientForTool.client.getServerVersion()?.name || "unknown"
          }:`,
          error,
        );
        throw error;
      }

      logger.warn(
        `Backend connection lost for server ${serverUuid} on tool "${name}"; invalidating pool and retrying once.`,
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
    createToolOverridesListToolsMiddleware({ cacheEnabled: true }),
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

  // Cache the processed namespace snapshot and expose it through MCP cursor
  // pagination. Large tool registries no longer require one enormous payload.
  const toolListSnapshots = new Map<
    string,
    { result: ListToolsResult; expiresAt: number }
  >();
  let latestToolListSnapshotId: string | undefined;
  let pendingToolListSnapshot: Promise<string> | undefined;
  const snapshotTtlMs = Math.max(
    5_000,
    Number.parseInt(
      process.env.MCP_TOOLS_LIST_SNAPSHOT_TTL_MS || "60000",
      10,
    ) || 60000,
  );
  const configuredPageSize = Number.parseInt(
    process.env.MCP_TOOLS_LIST_PAGE_SIZE || "100",
    10,
  );
  const toolListPageSize =
    Number.isFinite(configuredPageSize) && configuredPageSize > 0
      ? Math.min(configuredPageSize, 500)
      : 100;

  const createToolListSnapshot = async (
    request: Parameters<typeof listToolsWithMiddleware>[0],
  ): Promise<string> => {
    const result = await listToolsWithMiddleware(
      { ...request, params: { ...request.params, cursor: undefined } },
      handlerContext,
    );
    const adminContext = getAdminToolsContext(handlerContext.sessionId);
    if (adminContext?.enabled && adminContext.userId) {
      result.tools.push(...getAdminToolsForMcp());
    }

    const totalToolCount = result.tools.length;
    if (totalToolCount > maxExposedTools) {
      result.tools = limitToolsFairly(result.tools, maxExposedTools);
      logger.warn(
        `Namespace ${namespaceUuid} exposes ${totalToolCount} tools; limiting this endpoint to ${maxExposedTools} (${totalToolCount - maxExposedTools} omitted) to satisfy client connector limits.`,
      );
    }

    const snapshotId = randomUUID();
    toolListSnapshots.set(snapshotId, {
      result,
      expiresAt: Date.now() + snapshotTtlMs,
    });
    latestToolListSnapshotId = snapshotId;

    for (const [id, snapshot] of toolListSnapshots) {
      if (snapshot.expiresAt <= Date.now() || toolListSnapshots.size > 4) {
        toolListSnapshots.delete(id);
      }
    }
    return snapshotId;
  };

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    let snapshotId: string | undefined;
    let offset = 0;
    const cursor = request.params?.cursor;

    if (cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf8"),
        ) as {
          snapshotId?: string;
          offset?: number;
        };
        if (
          typeof decoded.snapshotId === "string" &&
          Number.isSafeInteger(decoded.offset) &&
          (decoded.offset ?? -1) >= 0
        ) {
          snapshotId = decoded.snapshotId;
          offset = decoded.offset ?? 0;
        }
      } catch {
        // Invalid cursors start a fresh snapshot.
      }
    }

    let snapshot = snapshotId ? toolListSnapshots.get(snapshotId) : undefined;
    if (!snapshot || snapshot.expiresAt <= Date.now()) {
      if (cursor) offset = 0;
      const latest = latestToolListSnapshotId
        ? toolListSnapshots.get(latestToolListSnapshotId)
        : undefined;
      if (!cursor && latest && latest.expiresAt > Date.now()) {
        snapshotId = latestToolListSnapshotId;
        snapshot = latest;
      } else {
        if (!pendingToolListSnapshot) {
          pendingToolListSnapshot = createToolListSnapshot(request).finally(
            () => {
              pendingToolListSnapshot = undefined;
            },
          );
        }
        snapshotId = await pendingToolListSnapshot;
        snapshot = toolListSnapshots.get(snapshotId);
      }
    }

    if (!snapshot || !snapshotId) {
      throw new Error("Unable to create MCP tools/list snapshot");
    }

    const tools = snapshot.result.tools;
    const page = tools.slice(offset, offset + toolListPageSize);
    const nextOffset = offset + page.length;
    const nextCursor =
      nextOffset < tools.length
        ? Buffer.from(
            JSON.stringify({ snapshotId, offset: nextOffset }),
          ).toString("base64url")
        : undefined;

    return {
      ...snapshot.result,
      tools: page,
      ...(nextCursor ? { nextCursor } : { nextCursor: undefined }),
    };
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
