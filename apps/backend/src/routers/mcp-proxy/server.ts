import { randomUUID } from "node:crypto";

import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  DatabaseMcpServer,
  McpServerErrorStatusEnum,
  McpServerTypeEnum,
  ServerParameters,
} from "@repo/zod-types";
import express from "express";
import { findActualExecutable } from "spawn-rx";

import logger from "@/utils/logger";

import { mcpServersRepository } from "../../db/repositories";
import mcpProxy from "../../lib/mcp-proxy";
import { transformDockerUrl } from "../../lib/metamcp/client";
import { mcpServerPool } from "../../lib/metamcp/mcp-server-pool";
import {
  convertDbServerToParams,
  resolveEnvVariables,
} from "../../lib/metamcp/utils";
import { ProcessManagedStdioTransport } from "../../lib/stdio-transport/process-managed-transport";
import { betterAuthMcpMiddleware } from "../../middleware/better-auth-mcp.middleware";

const SSE_HEADERS_PASSTHROUGH = ["authorization"];
const STREAMABLE_HTTP_HEADERS_PASSTHROUGH = [
  "authorization",
  "mcp-session-id",
  "last-event-id",
];

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

// Raised when the requested MCP server does not exist or is not accessible to
// the authenticated user. Answered with 404 so existence is not disclosed.
class InspectorTargetNotFoundError extends Error {
  constructor() {
    super("MCP server not found");
    this.name = "InspectorTargetNotFoundError";
  }
}

interface InspectorTarget {
  server: DatabaseMcpServer;
  params: ServerParameters;
  stdio?: { cmd: string; args: string[]; env: Record<string, string> };
}

const getRequestUserId = (req: express.Request): string | undefined =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).user?.id;

// Resolve the MCP server the inspector wants to connect to. Connection
// parameters (command, args, env, url, headers) always come from the stored
// server configuration, never from the request, so an authenticated session
// cannot spawn arbitrary processes or reach arbitrary URLs through this proxy
// (CVE-2026-79538). Only the owner's servers and public servers are reachable.
const resolveInspectorTarget = async (
  req: express.Request,
): Promise<InspectorTarget> => {
  const serverUuid = req.query.mcpServerUuid;
  const userId = getRequestUserId(req);
  if (typeof serverUuid !== "string" || !serverUuid || !userId) {
    throw new InspectorTargetNotFoundError();
  }

  const server = await mcpServersRepository.findByUuid(serverUuid);
  if (!server || (server.user_id !== null && server.user_id !== userId)) {
    throw new InspectorTargetNotFoundError();
  }

  const params = await convertDbServerToParams(server);
  if (!params) {
    logger.warn(
      `Could not build connection parameters for server ${server.uuid}`,
    );
    throw new InspectorTargetNotFoundError();
  }

  if (params.type === McpServerTypeEnum.enum.STDIO) {
    if (!params.command) {
      throw new InspectorTargetNotFoundError();
    }
    const env = resolveEnvVariables(params.env || {}) as Record<string, string>;
    const { cmd, args } = findActualExecutable(
      params.command,
      params.args || [],
    );
    return { server, params, stdio: { cmd, args, env } };
  }

  return { server, params };
};

const sendInspectorTargetNotFound = (res: express.Response) => {
  res.status(404).json({ error: "MCP server not found" });
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

// The frontend no longer receives the bearer token / OAuth tokens of public
// servers unless the user is an administrator (they are redacted by the
// serializers), so it cannot forward them. When the request carries no
// Authorization header, fall back to the stored credentials, mirroring what
// the MetaMCP client does for namespace connections.
const withStoredAuthorization = (
  headers: Record<string, string>,
  params: ServerParameters,
): Record<string, string> => {
  const hasAuthorization = Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization",
  );
  if (hasAuthorization) return headers;
  const storedToken =
    params.oauth_tokens?.access_token || params.bearerToken || undefined;
  if (!storedToken) return headers;
  return { ...headers, Authorization: `Bearer ${storedToken}` };
};

const serverRouter = express.Router();

// Apply better auth middleware to all MCP proxy routes
serverRouter.use(betterAuthMcpMiddleware);

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Web app transports by web app sessionId
const serverTransports: Map<string, Transport> = new Map<string, Transport>(); // Server Transports by web app sessionId
const sessionOwners: Map<string, string> = new Map<string, string>(); // User id by web app sessionId

// A proxy session may only be used by the user who opened it.
const isSessionOwner = (
  sessionId: string | undefined,
  req: express.Request,
): boolean => {
  const userId = getRequestUserId(req);
  return !!sessionId && !!userId && sessionOwners.get(sessionId) === userId;
};

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

  sessionOwners.delete(sessionId);

  logger.info(`Session ${sessionId} cleanup completed`);
};

const createTransport = async (
  req: express.Request,
  target: InspectorTarget,
): Promise<Transport> => {
  const { server, params } = target;

  if (server.error_status === McpServerErrorStatusEnum.enum.ERROR) {
    logger.info(`Server ${server.name} (${server.uuid}) is in ERROR state`);
    throw new Error(
      `Server is in error state and cannot be connected to. Please check the server configuration and try again later.`,
    );
  }

  if (params.type === McpServerTypeEnum.enum.STDIO && target.stdio) {
    const { cmd, args, env } = target.stdio;

    // Check if this command is in cooldown
    if (isStdioInCooldown(cmd, args, env)) {
      logger.info(`STDIO command in cooldown for server ${server.uuid}`);
      const cooldownEnd = stdioCommandCooldowns.get(
        createStdioKey(cmd, args, env),
      );
      if (cooldownEnd) {
        throw new Error(
          `Server "${server.name}" is in cooldown. Please wait ${Math.ceil((cooldownEnd - Date.now()) / 1000)} seconds before retrying.`,
        );
      }
    }

    logger.info(
      `STDIO transport for server ${server.name} (${server.uuid}): command=${cmd}`,
    );

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
        `STDIO command failed for server ${server.uuid}, setting cooldown`,
      );
      throw error;
    }
  } else if (params.type === McpServerTypeEnum.enum.SSE && params.url) {
    const url = transformDockerUrl(params.url);

    // Merge custom headers from database with passthrough headers from request
    const headers = withStoredAuthorization(
      {
        ...(params.headers || {}),
        ...getHttpHeaders(req, params.type),
      },
      params,
    );

    // Log only origin and path: the stored URL may carry credentials in
    // its query string.
    const targetUrl = new URL(url);
    logger.info(
      `SSE transport for server ${server.name} (${server.uuid}): url=${targetUrl.origin}${targetUrl.pathname}, headers=${Object.keys(headers).join(",")}`,
    );

    const transport = new SSEClientTransport(targetUrl, {
      eventSourceInit: {
        fetch: (url, init) => fetch(url, { ...init, headers }),
      },
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else if (
    params.type === McpServerTypeEnum.enum.STREAMABLE_HTTP &&
    params.url
  ) {
    const url = transformDockerUrl(params.url);

    // Merge custom headers from database with passthrough headers from request
    const headers = withStoredAuthorization(
      {
        ...(params.headers || {}),
        ...getHttpHeaders(req, params.type),
      },
      params,
    );

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else {
    logger.error(
      `Invalid transport type ${params.type} for server ${server.uuid}`,
    );
    throw new Error("Invalid transport type specified");
  }
};

serverRouter.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  // logger.info(`Received GET message for sessionId ${sessionId}`);
  try {
    const transport = (
      isSessionOwner(sessionId, req)
        ? webAppTransports.get(sessionId)
        : undefined
    ) as StreamableHTTPServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    } else {
      await transport.handleRequest(req, res);
    }
  } catch (error) {
    logger.error("Error in /mcp route:", error);
    res.status(500).json(error);
  }
});

serverRouter.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let serverTransport: Transport | undefined;
  if (!sessionId) {
    try {
      logger.info("New StreamableHttp connection request");
      let target: InspectorTarget;
      try {
        target = await resolveInspectorTarget(req);
        serverTransport = await createTransport(req, target);
      } catch (error) {
        if (error instanceof InspectorTargetNotFoundError) {
          sendInspectorTargetNotFound(res);
          return;
        }
        if (error instanceof SseError && error.code === 401) {
          logger.error(
            "Received 401 Unauthorized from MCP server:",
            error.message,
          );
          res.status(401).json(error);
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

          const serverUuid = target.server.uuid;

          // Report crash to server pool
          mcpServerPool
            .handleServerCrashWithoutNamespace(serverUuid, exitCode, signal)
            .catch((error) => {
              logger.error(
                `Error reporting StreamableHttp STDIO crash to server pool for ${serverUuid}:`,
                error,
              );
            });
        };
      }

      // Generate session ID upfront for better tracking
      const newSessionId = randomUUID();

      const webAppTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (sessionId) => {
          webAppTransports.set(sessionId, webAppTransport);
          sessionOwners.set(sessionId, getRequestUserId(req) as string);
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
      res.status(500).json(error);
    }
  } else {
    // logger.info(`Received POST message for sessionId ${sessionId}`);
    try {
      const transport = (
        isSessionOwner(sessionId, req)
          ? webAppTransports.get(sessionId)
          : undefined
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
      res.status(500).json(error);
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
      const serverTransport = (
        isSessionOwner(sessionId, req)
          ? serverTransports.get(sessionId)
          : undefined
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
      res.status(500).json(error);
    }
  } else {
    res.status(400).end("Missing sessionId");
  }
});

serverRouter.get("/stdio", async (req, res) => {
  try {
    logger.info("New STDIO connection request");
    let serverTransport: Transport | undefined;
    let target: InspectorTarget;
    try {
      target = await resolveInspectorTarget(req);
      if (!target.stdio) {
        throw new InspectorTargetNotFoundError();
      }
      serverTransport = await createTransport(req, target);
      logger.info("Created server transport");
    } catch (error) {
      if (error instanceof InspectorTargetNotFoundError) {
        sendInspectorTargetNotFound(res);
        return;
      }
      if (error instanceof SseError && error.code === 401) {
        logger.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        res.status(401).json(error);
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
    sessionOwners.set(
      webAppTransport.sessionId,
      getRequestUserId(req) as string,
    );
    const stdioTarget = target.stdio;

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

      const serverUuid = target.server.uuid;
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
    };

    // Monitor for quick failures and set cooldown
    const commandStartTime = Date.now();
    const QUICK_FAILURE_THRESHOLD = 5000; // 5 seconds

    // Handle transport close events
    stdinTransport.onclose = () => {
      const runTime = Date.now() - commandStartTime;
      if (runTime < QUICK_FAILURE_THRESHOLD) {
        // Process failed quickly, likely a startup error
        const { cmd, args, env } = stdioTarget;

        setStdioCooldown(cmd, args, env);
        logger.info(
          `STDIO process terminated quickly (${runTime}ms), setting cooldown for server ${target.server.uuid}`,
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
            const { cmd, args, env } = stdioTarget;

            setStdioCooldown(cmd, args, env);
            logger.info(
              `STDIO process reported startup error, setting cooldown for server ${target.server.uuid}`,
            );
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
    res.status(500).json(error);
  }
});

serverRouter.get("/sse", async (req, res) => {
  try {
    logger.info(
      "New SSE connection request. NOTE: The sse transport is deprecated and has been replaced by StreamableHttp",
    );
    let serverTransport: Transport | undefined;
    try {
      const target = await resolveInspectorTarget(req);
      if (target.params.type !== McpServerTypeEnum.enum.SSE) {
        throw new InspectorTargetNotFoundError();
      }
      serverTransport = await createTransport(req, target);
    } catch (error) {
      if (error instanceof InspectorTargetNotFoundError) {
        sendInspectorTargetNotFound(res);
        return;
      }
      if (error instanceof SseError && error.code === 401) {
        logger.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        res.status(401).json(error);
        return;
      } else if (error instanceof SseError && error.code === 404) {
        logger.error(
          "Received 404 not found from MCP server. Does the MCP server support SSE?",
        );
        res.status(404).json(error);
        return;
      } else if (JSON.stringify(error).includes("ECONNREFUSED")) {
        logger.error("Connection refused. Is the MCP server running?");
        res.status(500).json(error);
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
      sessionOwners.set(
        webAppTransport.sessionId,
        getRequestUserId(req) as string,
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
    res.status(500).json(error);
  }
});

serverRouter.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    // logger.info(`Received POST message for sessionId ${sessionId}`);

    const transport = (
      isSessionOwner(sessionId as string, req)
        ? webAppTransports.get(sessionId as string)
        : undefined
    ) as SSEServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    logger.error("Error in /message route:", error);
    res.status(500).json(error);
  }
});

serverRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

export default serverRouter;
