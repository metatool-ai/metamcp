import { randomUUID } from "node:crypto";

import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type AccessPrincipal,
  McpServerErrorStatusEnum,
  McpServerTypeEnum,
} from "@repo/zod-types";
import express from "express";
import { parse as shellParseArgs } from "shell-quote";
import { findActualExecutable } from "spawn-rx";

import logger from "@/utils/logger";

import { mcpServersRepository } from "../../db/repositories";
import { accessService } from "../../lib/access/access.service";
import { canInspect, hasCapability } from "../../lib/access/policy";
import {
  forgetProxySession,
  recordProxySessionOwner,
  requireProxySessionOwner,
} from "../../lib/access/proxy-session-owners";
import { hasLevel } from "../../lib/access/resource-guards";
import { sendError } from "../../lib/errors";
import mcpProxy from "../../lib/mcp-proxy";
import {
  createMetaMcpClient,
  transformDockerUrl,
} from "../../lib/metamcp/client";
import { mcpServerPool } from "../../lib/metamcp/mcp-server-pool";
import {
  convertDbServerToParams,
  getDefaultEnvironment as getSafeInheritedEnvironment,
  resolveEnvVariables,
} from "../../lib/metamcp/utils";
import { guardedFetch } from "../../lib/net/egress-guard";
import { ProcessManagedStdioTransport } from "../../lib/stdio-transport/process-managed-transport";
import { betterAuthMcpMiddleware } from "../../middleware/better-auth-mcp.middleware";

const SSE_HEADERS_PASSTHROUGH = ["authorization"];
const STREAMABLE_HTTP_HEADERS_PASSTHROUGH = [
  "authorization",
  "mcp-session-id",
  "last-event-id",
];

const defaultEnvironment = {
  ...getDefaultEnvironment(),
};

// Cooldown mechanism for failed STDIO commands
const STDIO_COOLDOWN_DURATION = 10000; // 10 seconds
const stdioCommandCooldowns = new Map<string, number>();

// Function to create a key for STDIO commands
const createStdioKey = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => {
  return `${command}:${args.join(",")}:${JSON.stringify(env)}`;
};

// Function to check if a STDIO command is in cooldown
const isStdioInCooldown = (
  command: string,
  args: string[],
  env: Record<string, string>,
): boolean => {
  const key = createStdioKey(command, args, env);
  const cooldownEnd = stdioCommandCooldowns.get(key);
  if (cooldownEnd && Date.now() < cooldownEnd) {
    return true;
  }
  if (cooldownEnd && Date.now() >= cooldownEnd) {
    stdioCommandCooldowns.delete(key);
  }
  return false;
};

// Function to set a STDIO command in cooldown
const setStdioCooldown = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => {
  const key = createStdioKey(command, args, env);
  stdioCommandCooldowns.set(key, Date.now() + STDIO_COOLDOWN_DURATION);
};

// Function to extract server UUID from STDIO command
const extractServerUuidFromStdioCommand = async (
  command: string,
  args: string[],
): Promise<string | null> => {
  try {
    // For filesys server, the command is typically: npx @modelcontextprotocol/server-filesystem /workspaceFolder
    // We need to find the server in the database that matches this command pattern

    // First, try to find by command and args pattern
    const fullCommand = `${command} ${args.join(" ")}`;
    // Arguments can hold credentials (connection strings, tokens): never log them.
    logger.info(
      `Looking for server with command: ${command} (${args.length} argument(s))`,
    );

    // Look for servers that match this command pattern
    const servers = await mcpServersRepository.findAll();
    logger.info(`Found ${servers.length} servers in database`);

    for (const server of servers) {
      if (server.type === "STDIO" && server.command) {
        const serverCommand = `${server.command} ${(server.args || []).join(" ")}`;
        logger.debug(`Checking server ${server.name} (${server.uuid})`);
        if (serverCommand === fullCommand) {
          logger.info(
            `Found exact match for server ${server.name} (${server.uuid})`,
          );
          return server.uuid;
        }
      }
    }

    // If no exact match, try to find by command only (for cases where args might vary)
    for (const server of servers) {
      if (server.type === "STDIO" && server.command === command) {
        logger.info(
          `Found command-only match for server ${server.name} (${server.uuid})`,
        );
        return server.uuid;
      }
    }

    logger.info(`No server found for command: ${command}`);
    return null;
  } catch (error) {
    logger.error("Error extracting server UUID from STDIO command:", error);
    return null;
  }
};

// Function to check if server is in error state
const checkServerErrorStatus = async (serverUuid: string): Promise<boolean> => {
  try {
    const server = await mcpServersRepository.findByUuid(serverUuid);
    if (!server) {
      logger.info(`Server ${serverUuid} not found`);
      return false;
    }

    const isInError =
      server.error_status === McpServerErrorStatusEnum.enum.ERROR;
    if (isInError) {
      logger.info(`Server ${server.name} (${serverUuid}) is in ERROR state`);
    }
    return isInError;
  } catch (error) {
    logger.error(
      `Error checking server error status for ${serverUuid}:`,
      error,
    );
    return false;
  }
};

// Function to get HTTP headers.
// Supports only "SSE" and "STREAMABLE_HTTP" transport types.
const getHttpHeaders = (
  req: express.Request,
  transportType: string,
): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept:
      transportType === McpServerTypeEnum.enum.SSE
        ? "text/event-stream"
        : "text/event-stream, application/json",
  };
  const defaultHeaders =
    transportType === McpServerTypeEnum.enum.SSE
      ? SSE_HEADERS_PASSTHROUGH
      : STREAMABLE_HTTP_HEADERS_PASSTHROUGH;

  for (const key of defaultHeaders) {
    if (req.headers[key] === undefined) {
      continue;
    }

    const value = req.headers[key];
    headers[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }

  // If the header "x-custom-auth-header" is present, use its value as the custom header name.
  if (req.headers["x-custom-auth-header"] !== undefined) {
    const customHeaderName = req.headers["x-custom-auth-header"] as string;
    const lowerCaseHeaderName = customHeaderName.toLowerCase();
    if (req.headers[lowerCaseHeaderName] !== undefined) {
      const value = req.headers[lowerCaseHeaderName];
      headers[customHeaderName] = value as string;
    }
  }
  return headers;
};

const serverRouter = express.Router();

// Apply better auth middleware to all MCP proxy routes
serverRouter.use(betterAuthMcpMiddleware);
// Inspector sessions can only be driven by the user who opened them
serverRouter.use(requireProxySessionOwner);

/** Access denials surfaced to the inspector with a proper HTTP status. */
class InspectorAccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getPrincipal(req: express.Request): AccessPrincipal {
  const principal = (req as express.Request & { principal?: AccessPrincipal })
    .principal;
  if (!principal) {
    throw new InspectorAccessError(401, "Authentication required");
  }
  return principal;
}

const INSPECTOR_DENIED =
  "Access denied: your role does not allow using the MCP inspector.";

/**
 * Connects to a stored MCP server using its configuration from the database
 * (command, env, URL, headers, bearer / OAuth tokens), never values sent by
 * the browser. Users with "use" access can inspect a server without ever
 * seeing its secrets.
 */
async function createTransportForStoredServer(
  req: express.Request,
  principal: AccessPrincipal,
  mcpServerUuid: string,
): Promise<Transport> {
  const server = await mcpServersRepository.findByUuid(mcpServerUuid);
  const access = server
    ? await accessService.resolveAccessOne(principal, "mcp_server", server)
    : null;
  if (!server || !access) {
    throw new InspectorAccessError(404, "MCP server not found");
  }
  // People who can edit a server can always test it (tools, OAuth setup);
  // calling the tools of a server that is only shared for use from the web
  // UI (outside audited endpoints) requires the inspector permission.
  if (!canInspect(principal, access)) {
    throw new InspectorAccessError(403, INSPECTOR_DENIED);
  }
  if (server.error_status === McpServerErrorStatusEnum.enum.ERROR) {
    throw new Error(
      `Server is in error state and cannot be connected to. Please check the server configuration and try again later.`,
    );
  }

  const params = await convertDbServerToParams(server);
  if (!params) {
    throw new Error("Invalid MCP server configuration");
  }

  // Editors running an OAuth flow from the inspector present the fresh
  // upstream token themselves; everyone else uses the stored credentials.
  const clientAuthorization = req.headers.authorization;
  if (
    clientAuthorization &&
    hasLevel(access, "edit") &&
    params.type !== McpServerTypeEnum.enum.STDIO
  ) {
    params.oauth_tokens = null;
    params.bearerToken = null;
    params.headers = {
      ...(params.headers || {}),
      Authorization: clientAuthorization,
    };
  }

  const { transport } = createMetaMcpClient(params);
  if (!transport) {
    throw new Error("Unsupported MCP server type");
  }
  // Server output often echoes its configuration (tokens, connection
  // strings): only people who can edit the server may read it.
  if (!hasLevel(access, "edit")) {
    stderrHiddenTransports.add(transport);
  }
  await transport.start();
  return transport;
}

/** Transports whose stderr is not relayed to the inspector (see above). */
const stderrHiddenTransports = new WeakSet<Transport>();

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Web app transports by web app sessionId
const serverTransports: Map<string, Transport> = new Map<string, Transport>(); // Server Transports by web app sessionId

// Session cleanup function
const cleanupSession = async (sessionId: string) => {
  logger.info(`Cleaning up proxy session ${sessionId}`);

  // Clean up web app transport
  const webAppTransport = webAppTransports.get(sessionId);
  if (webAppTransport) {
    try {
      await webAppTransport.close();
    } catch (error) {
      logger.error(
        `Error closing web app transport for session ${sessionId}:`,
        error,
      );
    }
    webAppTransports.delete(sessionId);
  }
  forgetProxySession(sessionId);

  // Clean up server transport
  const serverTransport = serverTransports.get(sessionId);
  if (serverTransport) {
    try {
      await serverTransport.close();
    } catch (error) {
      logger.error(
        `Error closing server transport for session ${sessionId}:`,
        error,
      );
    }
    serverTransports.delete(sessionId);
  }

  logger.info(`Session ${sessionId} cleanup completed`);
};

const createTransport = async (req: express.Request): Promise<Transport> => {
  const query = req.query;
  const principal = getPrincipal(req);

  const transportType = query.transportType as string;

  // Stored server: resolve everything server-side, with an access check.
  if (typeof query.mcpServerUuid === "string" && query.mcpServerUuid) {
    return await createTransportForStoredServer(
      req,
      principal,
      query.mcpServerUuid,
    );
  }

  // Ad-hoc connection (command / URL typed by the user): only for people who
  // may use the inspector and create such a server anyway.
  if (!hasCapability(principal, "inspector.use")) {
    throw new InspectorAccessError(403, INSPECTOR_DENIED);
  }
  if (
    transportType === McpServerTypeEnum.enum.STDIO &&
    !hasCapability(principal, "mcp_servers.create_stdio")
  ) {
    throw new InspectorAccessError(
      403,
      "Access denied: running ad-hoc STDIO commands requires the STDIO servers permission.",
    );
  }
  if (
    transportType !== McpServerTypeEnum.enum.STDIO &&
    !hasCapability(principal, "mcp_servers.create")
  ) {
    throw new InspectorAccessError(
      403,
      "Access denied: connecting to arbitrary MCP servers requires the permission to add MCP servers.",
    );
  }

  if (transportType === McpServerTypeEnum.enum.STDIO) {
    const command = query.command as string;
    const origArgs = shellParseArgs(query.args as string) as string[];
    const queryEnv = query.env ? JSON.parse(query.env as string) : {};

    // Resolve environment variable placeholders
    const resolvedQueryEnv = resolveEnvVariables(queryEnv);

    // Same inheritance as stored STDIO servers: a safe allow-list, never the
    // backend's own environment (DATABASE_URL, BETTER_AUTH_SECRET, ...).
    const env = {
      ...defaultEnvironment,
      ...getSafeInheritedEnvironment(),
      ...resolvedQueryEnv,
    };

    const { cmd, args } = findActualExecutable(command, origArgs);

    // Check if this command is in cooldown
    if (isStdioInCooldown(cmd, args, env)) {
      logger.info(
        `STDIO command in cooldown: ${cmd} (${args.length} argument(s))`,
      );
      const cooldownEnd = stdioCommandCooldowns.get(
        createStdioKey(cmd, args, env),
      );
      if (cooldownEnd) {
        throw new Error(
          `Command "${cmd}" is in cooldown. Please wait ${Math.ceil((cooldownEnd - Date.now()) / 1000)} seconds before retrying.`,
        );
      }
    }

    // Check if the server is in error state
    const serverUuid = await extractServerUuidFromStdioCommand(cmd, args);
    if (serverUuid) {
      const isInError = await checkServerErrorStatus(serverUuid);
      if (isInError) {
        throw new Error(
          `Server is in error state and cannot be connected to. Please check the server configuration and try again later.`,
        );
      }
    }

    logger.info(`STDIO transport: command=${cmd} (${args.length} argument(s))`);

    const transport = new ProcessManagedStdioTransport({
      command: cmd,
      args,
      env,
      stderr: "pipe",
    });

    try {
      await transport.start();
      return transport;
    } catch (error) {
      // If the transport fails to start, put it in cooldown
      setStdioCooldown(cmd, args, env);
      logger.info(
        `STDIO command failed, setting cooldown: ${cmd} (${args.length} argument(s))`,
      );
      throw error;
    }
  } else if (transportType === McpServerTypeEnum.enum.SSE) {
    const url = transformDockerUrl(query.url as string);

    // Ad-hoc connection: only the caller's own headers are sent. Stored
    // servers (and their credentials) are reached through mcpServerUuid,
    // after an access check; they used to be looked up by URL here, which
    // lent another user's stored headers to anyone typing the same URL.
    const headers = getHttpHeaders(req, transportType);

    logger.info(
      `SSE transport: ${new URL(url).origin} (${Object.keys(headers).length} header(s))`,
    );

    const transport = new SSEClientTransport(new URL(url), {
      fetch: guardedFetch,
      eventSourceInit: {
        fetch: (url, init) => guardedFetch(url, { ...init, headers }),
      },
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else if (transportType === McpServerTypeEnum.enum.STREAMABLE_HTTP) {
    const url = transformDockerUrl(query.url as string);

    // Ad-hoc connection: only the caller's own headers (see the SSE branch)
    const headers = getHttpHeaders(req, transportType);

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: guardedFetch,
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else {
    logger.error(`Invalid transport type: ${transportType}`);
    throw new Error("Invalid transport type specified");
  }
};

serverRouter.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  // logger.info(`Received GET message for sessionId ${sessionId}`);
  try {
    const transport = webAppTransports.get(
      sessionId,
    ) as StreamableHTTPServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    } else {
      await transport.handleRequest(req, res);
    }
  } catch (error) {
    logger.error("Error in /mcp route:", error);
    sendError(res, 500, "Internal server error");
  }
});

serverRouter.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let serverTransport: Transport | undefined;
  if (!sessionId) {
    try {
      logger.info("New StreamableHttp connection request");
      try {
        serverTransport = await createTransport(req);
      } catch (error) {
        if (error instanceof InspectorAccessError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        if (error instanceof SseError && error.code === 401) {
          logger.error(
            "Received 401 Unauthorized from MCP server:",
            error.message,
          );
          sendError(res, 401, "The MCP server refused the credentials");
          return;
        }

        throw error;
      }

      logger.info("Created StreamableHttp server transport");

      // Set up crash detection for STDIO transports in StreamableHttp route
      if (serverTransport instanceof ProcessManagedStdioTransport) {
        serverTransport.onprocesscrash = async (exitCode, signal) => {
          logger.warn(
            `StreamableHttp STDIO process crashed with code: ${exitCode}, signal: ${signal}`,
          );

          // Try to extract server UUID from the command/args
          const query = req.query;
          const command = query.command as string;
          const origArgs = shellParseArgs(query.args as string) as string[];

          const serverUuid = await extractServerUuidFromStdioCommand(
            command,
            origArgs,
          );

          if (serverUuid) {
            // Report crash to server pool
            mcpServerPool
              .handleServerCrashWithoutNamespace(serverUuid, exitCode, signal)
              .catch((error) => {
                logger.error(
                  `Error reporting StreamableHttp STDIO crash to server pool for ${serverUuid}:`,
                  error,
                );
              });
          } else {
            logger.warn(
              `Could not determine server UUID for crashed StreamableHttp STDIO process: ${command} ${origArgs.join(" ")}`,
            );
          }
        };
      }

      // Generate session ID upfront for better tracking
      const newSessionId = randomUUID();

      const webAppTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sessionId) => {
          webAppTransports.set(sessionId, webAppTransport);
          recordProxySessionOwner(sessionId, getPrincipal(req).userId, () =>
            cleanupSession(sessionId),
          );
          if (serverTransport) {
            serverTransports.set(sessionId, serverTransport);
          }
          logger.info("Client <-> Proxy  sessionId: " + sessionId);
        },
      });
      logger.info("Created StreamableHttp client transport");

      await webAppTransport.start();

      // Set up proxy connection with error handling
      try {
        mcpProxy({
          transportToClient: webAppTransport,
          transportToServer: serverTransport,
          onCleanup: async () => {
            await cleanupSession(newSessionId);
          },
        });
      } catch (error) {
        logger.error(
          `Error setting up proxy for session ${newSessionId}:`,
          error,
        );
        await cleanupSession(newSessionId);
        throw error;
      }

      // Handle the actual request - don't pass req.body since it wasn't parsed
      await (webAppTransport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
      );
    } catch (error) {
      logger.error("Error in /mcp POST route:", error);
      sendError(res, 500, "Internal server error");
    }
  } else {
    // logger.info(`Received POST message for sessionId ${sessionId}`);
    try {
      const transport = webAppTransports.get(
        sessionId,
      ) as StreamableHTTPServerTransport;
      if (!transport) {
        res.status(404).end("Transport not found for sessionId " + sessionId);
      } else {
        await (transport as StreamableHTTPServerTransport).handleRequest(
          req,
          res,
        );
      }
    } catch (error) {
      logger.error("Error in /mcp route:", error);
      sendError(res, 500, "Internal server error");
    }
  }
});

serverRouter.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const mcpServerName = (req.query.mcpServerName as string) || "Unknown Server";
  logger.info(
    `Received DELETE message for sessionId ${sessionId}, MCP server: ${mcpServerName}`,
  );

  if (sessionId) {
    try {
      const serverTransport = serverTransports.get(
        sessionId,
      ) as StreamableHTTPClientTransport;
      if (!serverTransport) {
        res.status(404).end("Transport not found for sessionId " + sessionId);
        return;
      }

      // Terminate the session and clean up
      try {
        await serverTransport.terminateSession();
      } catch (error) {
        logger.warn(`Warning: Error terminating session ${sessionId}:`, error);
        // Continue with cleanup even if termination fails
      }

      await cleanupSession(sessionId);
      logger.info(
        `Session ${sessionId} terminated and cleaned up successfully`,
      );
      res.status(200).end();
    } catch (error) {
      logger.error("Error in /mcp DELETE route:", error);
      sendError(res, 500, "Internal server error");
    }
  } else {
    res.status(400).end("Missing sessionId");
  }
});

serverRouter.get("/stdio", async (req, res) => {
  try {
    logger.info("New STDIO connection request");
    let serverTransport: Transport | undefined;
    try {
      serverTransport = await createTransport(req);
      logger.info("Created server transport");
    } catch (error) {
      if (error instanceof InspectorAccessError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SseError && error.code === 401) {
        logger.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        sendError(res, 401, "The MCP server refused the credentials");
        return;
      }

      throw error;
    }

    const webAppTransport = new SSEServerTransport(
      "/mcp-proxy/server/message",
      res,
    );
    logger.info("Created client transport");

    webAppTransports.set(webAppTransport.sessionId, webAppTransport);
    serverTransports.set(webAppTransport.sessionId, serverTransport);
    recordProxySessionOwner(
      webAppTransport.sessionId,
      getPrincipal(req).userId,
      () => cleanupSession(webAppTransport.sessionId),
    );

    // Handle cleanup when connection closes
    const handleConnectionClose = () => {
      logger.info(`Connection closed for session ${webAppTransport.sessionId}`);
      cleanupSession(webAppTransport.sessionId);
    };

    // Handle various connection termination scenarios
    res.on("close", handleConnectionClose);
    res.on("finish", handleConnectionClose);
    res.on("error", (error) => {
      logger.error(
        `Response error for SSE session ${webAppTransport.sessionId}:`,
        error,
      );
      handleConnectionClose();
    });

    await webAppTransport.start();

    const stdinTransport = serverTransport as ProcessManagedStdioTransport;

    // Set up crash detection for the server pool
    stdinTransport.onprocesscrash = async (exitCode, signal) => {
      logger.warn(
        `STDIO process crashed with code: ${exitCode}, signal: ${signal}`,
      );

      // Try to extract server UUID from the command/args
      const query = req.query;
      const command = query.command as string;
      const origArgs = shellParseArgs(query.args as string) as string[];

      logger.info(
        `STDIO crash handler called for command: ${command} ${origArgs.join(" ")}`,
      );

      // For filesys server, the server UUID might be in the args or we need to derive it
      // For now, we'll use a fallback approach to find the server UUID
      const serverUuid = await extractServerUuidFromStdioCommand(
        command,
        origArgs,
      );

      if (serverUuid) {
        logger.info(
          `Reporting crash to server pool for server UUID: ${serverUuid}`,
        );
        // Report crash to server pool
        mcpServerPool
          .handleServerCrashWithoutNamespace(serverUuid, exitCode, signal)
          .catch((error) => {
            logger.error(
              `Error reporting STDIO crash to server pool for ${serverUuid}:`,
              error,
            );
          });
      } else {
        logger.warn(
          `Could not determine server UUID for crashed STDIO process: ${command} ${origArgs.join(" ")}`,
        );
      }
    };

    // Monitor for quick failures and set cooldown
    const commandStartTime = Date.now();
    const QUICK_FAILURE_THRESHOLD = 5000; // 5 seconds

    // Handle transport close events
    stdinTransport.onclose = () => {
      const runTime = Date.now() - commandStartTime;
      if (runTime < QUICK_FAILURE_THRESHOLD) {
        // Process failed quickly, likely a startup error
        const query = req.query;
        const command = query.command as string;
        const origArgs = shellParseArgs(query.args as string) as string[];
        const queryEnv = query.env ? JSON.parse(query.env as string) : {};
        const resolvedQueryEnv = resolveEnvVariables(queryEnv);
        const env = {
          ...process.env,
          ...defaultEnvironment,
          ...resolvedQueryEnv,
        };
        const { cmd, args } = findActualExecutable(command, origArgs);

        setStdioCooldown(cmd, args, env);
        logger.info(
          `STDIO process terminated quickly (${runTime}ms), setting cooldown: ${cmd} (${args.length} argument(s))`,
        );
      }
    };

    if (stdinTransport.stderr) {
      stdinTransport.stderr.on("data", (chunk: Buffer) => {
        const errorContent = chunk.toString();
        if (errorContent.includes("MODULE_NOT_FOUND")) {
          webAppTransport
            .send({
              jsonrpc: "2.0",
              method: "notifications/stderr",
              params: {
                content: "Command not found, transports removed",
              },
            })
            .catch((error) => {
              // Ignore "Not connected" errors during cleanup
              if (error?.message && !error.message.includes("Not connected")) {
                logger.error("Error sending stderr notification:", error);
              }
            });
          webAppTransport.close();
          cleanupSession(webAppTransport.sessionId);
          logger.error("Command not found, transports removed");
        } else {
          // Check for common startup errors that should trigger cooldown
          if (
            errorContent.includes("ENOENT") ||
            errorContent.includes("no such file or directory")
          ) {
            const query = req.query;
            const command = query.command as string;
            const origArgs = shellParseArgs(query.args as string) as string[];
            const queryEnv = query.env ? JSON.parse(query.env as string) : {};
            const resolvedQueryEnv = resolveEnvVariables(queryEnv);
            const env = {
              ...process.env,
              ...defaultEnvironment,
              ...resolvedQueryEnv,
            };
            const { cmd, args } = findActualExecutable(command, origArgs);

            setStdioCooldown(cmd, args, env);
            logger.info(
              `STDIO process reported startup error, setting cooldown: ${cmd} (${args.length} argument(s))`,
            );
          }

          if (stderrHiddenTransports.has(serverTransport)) {
            return;
          }
          webAppTransport
            .send({
              jsonrpc: "2.0",
              method: "notifications/stderr",
              params: {
                content: errorContent,
              },
            })
            .catch((error) => {
              // Ignore "Not connected" errors as they're expected when connections close
              if (error?.message && !error.message.includes("Not connected")) {
                logger.error("Error sending stderr notification:", error);
              }
            });
        }
      });
    }

    mcpProxy({
      transportToClient: webAppTransport,
      transportToServer: serverTransport,
      onCleanup: async () => {
        await cleanupSession(webAppTransport.sessionId);
      },
    });
  } catch (error) {
    logger.error("Error in /stdio route:", error);
    sendError(res, 500, "Internal server error");
  }
});

serverRouter.get("/sse", async (req, res) => {
  try {
    logger.info(
      "New SSE connection request. NOTE: The sse transport is deprecated and has been replaced by StreamableHttp",
    );
    let serverTransport: Transport | undefined;
    try {
      serverTransport = await createTransport(req);
    } catch (error) {
      if (error instanceof InspectorAccessError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SseError && error.code === 401) {
        logger.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        sendError(res, 401, "The MCP server refused the credentials");
        return;
      } else if (error instanceof SseError && error.code === 404) {
        logger.error(
          "Received 404 not found from MCP server. Does the MCP server support SSE?",
        );
        sendError(
          res,
          404,
          "No MCP server answered at this address (does it support SSE?)",
        );
        return;
      } else if (JSON.stringify(error).includes("ECONNREFUSED")) {
        logger.error("Connection refused. Is the MCP server running?");
        sendError(
          res,
          502,
          "The MCP server refused the connection: is it running?",
        );
      } else {
        throw error;
      }
    }

    if (serverTransport) {
      const webAppTransport = new SSEServerTransport(
        "/mcp-proxy/server/message",
        res,
      );
      webAppTransports.set(webAppTransport.sessionId, webAppTransport);
      recordProxySessionOwner(
        webAppTransport.sessionId,
        getPrincipal(req).userId,
        () => cleanupSession(webAppTransport.sessionId),
      );
      logger.info("Created client transport");
      if (serverTransport) {
        serverTransports.set(webAppTransport.sessionId, serverTransport);
      }
      logger.info("Created server transport");

      // Handle cleanup when connection closes
      const handleConnectionClose = () => {
        logger.info(
          `Connection closed for session ${webAppTransport.sessionId}`,
        );
        cleanupSession(webAppTransport.sessionId);
      };

      // Handle various connection termination scenarios
      res.on("close", handleConnectionClose);
      res.on("finish", handleConnectionClose);
      res.on("error", (error) => {
        logger.error(
          `Response error for STDIO session ${webAppTransport.sessionId}:`,
          error,
        );
        handleConnectionClose();
      });

      await webAppTransport.start();

      mcpProxy({
        transportToClient: webAppTransport,
        transportToServer: serverTransport,
        onCleanup: async () => {
          await cleanupSession(webAppTransport.sessionId);
        },
      });
    }
  } catch (error) {
    logger.error("Error in /sse route:", error);
    sendError(res, 500, "Internal server error");
  }
});

serverRouter.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    // logger.info(`Received POST message for sessionId ${sessionId}`);

    const transport = webAppTransports.get(
      sessionId as string,
    ) as SSEServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    logger.error("Error in /message route:", error);
    sendError(res, 500, "Internal server error");
  }
});

serverRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

export default serverRouter;
