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
import { McpServerErrorStatusEnum, McpServerTypeEnum } from "@repo/zod-types";
import express from "express";
import { parse as shellParseArgs } from "shell-quote";
import { findActualExecutable } from "spawn-rx";

import { mcpServersRepository } from "../../db/repositories";
import mcpProxy from "../../lib/mcp-proxy";
import { transformDockerUrl } from "../../lib/metamcp/client";
import { mcpServerPool } from "../../lib/metamcp/mcp-server-pool";
import { resolveEnvVariables } from "../../lib/metamcp/utils";
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
    console.log(`Looking for server with command: ${fullCommand}`);

    // Look for servers that match this command pattern
    const servers = await mcpServersRepository.findAll();
    console.log(`Found ${servers.length} servers in database`);

    for (const server of servers) {
      if (server.type === "STDIO" && server.command) {
        const serverCommand = `${server.command} ${(server.args || []).join(" ")}`;
        console.log(
          `Checking server ${server.name} (${server.uuid}): ${serverCommand}`,
        );
        if (serverCommand === fullCommand) {
          console.log(
            `Found exact match for server ${server.name} (${server.uuid})`,
          );
          return server.uuid;
        }
      }
    }

    // If no exact match, try to find by command only (for cases where args might vary)
    for (const server of servers) {
      if (server.type === "STDIO" && server.command === command) {
        console.log(
          `Found command-only match for server ${server.name} (${server.uuid})`,
        );
        return server.uuid;
      }
    }

    console.log(`No server found for command: ${fullCommand}`);
    return null;
  } catch (error) {
    console.error("Error extracting server UUID from STDIO command:", error);
    return null;
  }
};

// Function to check if server is in error state
const checkServerErrorStatus = async (serverUuid: string): Promise<boolean> => {
  try {
    const server = await mcpServersRepository.findByUuid(serverUuid);
    if (!server) {
      console.log(`Server ${serverUuid} not found`);
      return false;
    }

    const isInError =
      server.error_status === McpServerErrorStatusEnum.Enum.ERROR;
    if (isInError) {
      console.log(`Server ${server.name} (${serverUuid}) is in ERROR state`);
    }
    return isInError;
  } catch (error) {
    console.error(
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
      transportType === McpServerTypeEnum.Enum.SSE
        ? "text/event-stream"
        : "text/event-stream, application/json",
  };
  const defaultHeaders =
    transportType === McpServerTypeEnum.Enum.SSE
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

const webAppTransports: Map<string, Transport> = new Map<string, Transport>(); // Web app transports by web app sessionId
const serverTransports: Map<string, Transport> = new Map<string, Transport>(); // Server Transports by web app sessionId

// Session cleanup function
const cleanupSession = async (sessionId: string) => {
  console.log(`Cleaning up proxy session ${sessionId}`);

  // Clean up web app transport
  const webAppTransport = webAppTransports.get(sessionId);
  if (webAppTransport) {
    try {
      await webAppTransport.close();
    } catch (error) {
      console.error(
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
      console.error(
        `Error closing server transport for session ${sessionId}:`,
        error,
      );
    }
    serverTransports.delete(sessionId);
  }

  console.log(`Session ${sessionId} cleanup completed`);
};

const createTransport = async (req: express.Request): Promise<Transport> => {
  const query = req.query;
  console.log("Query parameters:", JSON.stringify(query));

  const transportType = query.transportType as string;

  if (transportType === McpServerTypeEnum.Enum.STDIO) {
    const command = query.command as string;
    const origArgs = shellParseArgs(query.args as string) as string[];
    const queryEnv = query.env ? JSON.parse(query.env as string) : {};

    // Resolve environment variable placeholders
    const resolvedQueryEnv = resolveEnvVariables(queryEnv);

    const env = { ...process.env, ...defaultEnvironment, ...resolvedQueryEnv };

    const { cmd, args } = findActualExecutable(command, origArgs);

    // Check if this command is in cooldown
    if (isStdioInCooldown(cmd, args, env)) {
      console.log(`STDIO command in cooldown: ${cmd} ${args.join(" ")}`);
      const cooldownEnd = stdioCommandCooldowns.get(
        createStdioKey(cmd, args, env),
      );
      if (cooldownEnd) {
        throw new Error(
          `Command "${cmd} ${args.join(" ")}" is in cooldown. Please wait ${Math.ceil((cooldownEnd - Date.now()) / 1000)} seconds before retrying.`,
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

    console.log(`STDIO transport: command=${cmd}, args=${args}`);

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
      console.log(
        `STDIO command failed, setting cooldown: ${cmd} ${args.join(" ")}`,
      );
      throw error;
    }
  } else if (transportType === McpServerTypeEnum.Enum.SSE) {
    const url = transformDockerUrl(query.url as string);

    // Check if the server is in error state (for SSE, we need to find server by URL)
    const servers = await mcpServersRepository.findAll();
    const matchingServer = servers.find(
      (server) => server.type === "SSE" && server.url === url,
    );
    if (matchingServer) {
      const isInError = await checkServerErrorStatus(matchingServer.uuid);
      if (isInError) {
        throw new Error(
          `Server is in error state and cannot be connected to. Please check the server configuration and try again later.`,
        );
      }
    }

    const headers = getHttpHeaders(req, transportType);

    console.log(
      `SSE transport: url=${url}, headers=${JSON.stringify(headers)}`,
    );

    const transport = new SSEClientTransport(new URL(url), {
      eventSourceInit: {
        fetch: (url, init) => fetch(url, { ...init, headers }),
      },
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else if (transportType === McpServerTypeEnum.Enum.STREAMABLE_HTTP) {
    const url = transformDockerUrl(query.url as string);

    // Check if the server is in error state (for STREAMABLE_HTTP, we need to find server by URL)
    const servers = await mcpServersRepository.findAll();
    const matchingServer = servers.find(
      (server) => server.type === "STREAMABLE_HTTP" && server.url === url,
    );
    if (matchingServer) {
      const isInError = await checkServerErrorStatus(matchingServer.uuid);
      if (isInError) {
        throw new Error(
          `Server is in error state and cannot be connected to. Please check the server configuration and try again later.`,
        );
      }
    }

    const headers = getHttpHeaders(req, transportType);

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });
    await transport.start();
    return transport;
  } else {
    console.error(`Invalid transport type: ${transportType}`);
    throw new Error("Invalid transport type specified");
  }
};

serverRouter.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  // console.log(`Received GET message for sessionId ${sessionId}`);
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
    console.error("Error in /mcp route:", error);
    res.status(500).json(error);
  }
});

serverRouter.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let serverTransport: Transport | undefined;
  if (!sessionId) {
    try {
      console.log("New StreamableHttp connection request");
      try {
        serverTransport = await createTransport(req);
      } catch (error) {
        if (error instanceof SseError && error.code === 401) {
          console.error(
            "Received 401 Unauthorized from MCP server:",
            error.message,
          );
          res.status(401).json(error);
          return;
        }

        throw error;
      }

      console.log("Created StreamableHttp server transport");

      // Set up crash detection for STDIO transports in StreamableHttp route
      if (serverTransport instanceof ProcessManagedStdioTransport) {
        serverTransport.onprocesscrash = async (exitCode, signal) => {
          console.warn(
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
                console.error(
                  `Error reporting StreamableHttp STDIO crash to server pool for ${serverUuid}:`,
                  error,
                );
              });
          } else {
            console.warn(
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
          if (serverTransport) {
            serverTransports.set(sessionId, serverTransport);
          }
          console.log("Client <-> Proxy  sessionId: " + sessionId);
        },
      });
      console.log("Created StreamableHttp client transport");

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
        console.error(
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
      console.error("Error in /mcp POST route:", error);
      res.status(500).json(error);
    }
  } else {
    // console.log(`Received POST message for sessionId ${sessionId}`);
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
      console.error("Error in /mcp route:", error);
      res.status(500).json(error);
    }
  }
});

serverRouter.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const mcpServerName = (req.query.mcpServerName as string) || "Unknown Server";
  console.log(
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
        console.warn(`Warning: Error terminating session ${sessionId}:`, error);
        // Continue with cleanup even if termination fails
      }

      await cleanupSession(sessionId);
      console.log(
        `Session ${sessionId} terminated and cleaned up successfully`,
      );
      res.status(200).end();
    } catch (error) {
      console.error("Error in /mcp DELETE route:", error);
      res.status(500).json(error);
    }
  } else {
    res.status(400).end("Missing sessionId");
  }
});

serverRouter.get("/stdio", async (req, res) => {
  try {
    console.log("New STDIO connection request");
    let serverTransport: Transport | undefined;
    try {
      serverTransport = await createTransport(req);
      console.log("Created server transport");
    } catch (error) {
      if (error instanceof SseError && error.code === 401) {
        console.error(
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
    console.log("Created client transport");

    webAppTransports.set(webAppTransport.sessionId, webAppTransport);
    serverTransports.set(webAppTransport.sessionId, serverTransport);

    // Handle cleanup when connection closes
    const handleConnectionClose = () => {
      console.log(`Connection closed for session ${webAppTransport.sessionId}`);
      cleanupSession(webAppTransport.sessionId);
    };

    // Handle various connection termination scenarios
    res.on("close", handleConnectionClose);
    res.on("finish", handleConnectionClose);
    res.on("error", (error) => {
      console.error(
        `Response error for SSE session ${webAppTransport.sessionId}:`,
        error,
      );
      handleConnectionClose();
    });

    await webAppTransport.start();

    const stdinTransport = serverTransport as ProcessManagedStdioTransport;

    // Set up crash detection for the server pool
    stdinTransport.onprocesscrash = async (exitCode, signal) => {
      console.warn(
        `STDIO process crashed with code: ${exitCode}, signal: ${signal}`,
      );

      // Try to extract server UUID from the command/args
      const query = req.query;
      const command = query.command as string;
      const origArgs = shellParseArgs(query.args as string) as string[];

      console.log(
        `STDIO crash handler called for command: ${command} ${origArgs.join(" ")}`,
      );

      // For filesys server, the server UUID might be in the args or we need to derive it
      // For now, we'll use a fallback approach to find the server UUID
      const serverUuid = await extractServerUuidFromStdioCommand(
        command,
        origArgs,
      );

      if (serverUuid) {
        console.log(
          `Reporting crash to server pool for server UUID: ${serverUuid}`,
        );
        // Report crash to server pool
        mcpServerPool
          .handleServerCrashWithoutNamespace(serverUuid, exitCode, signal)
          .catch((error) => {
            console.error(
              `Error reporting STDIO crash to server pool for ${serverUuid}:`,
              error,
            );
          });
      } else {
        console.warn(
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
        console.log(
          `STDIO process terminated quickly (${runTime}ms), setting cooldown: ${cmd} ${args.join(" ")}`,
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
                console.error("Error sending stderr notification:", error);
              }
            });
          webAppTransport.close();
          cleanupSession(webAppTransport.sessionId);
          console.error("Command not found, transports removed");
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
            console.log(
              `STDIO process reported startup error, setting cooldown: ${cmd} ${args.join(" ")}`,
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
                console.error("Error sending stderr notification:", error);
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
    console.error("Error in /stdio route:", error);
    res.status(500).json(error);
  }
});

serverRouter.get("/sse", async (req, res) => {
  try {
    console.log(
      "New SSE connection request. NOTE: The sse transport is deprecated and has been replaced by StreamableHttp",
    );
    let serverTransport: Transport | undefined;
    try {
      serverTransport = await createTransport(req);
    } catch (error) {
      if (error instanceof SseError && error.code === 401) {
        console.error(
          "Received 401 Unauthorized from MCP server. Authentication failure.",
        );
        res.status(401).json(error);
        return;
      } else if (error instanceof SseError && error.code === 404) {
        console.error(
          "Received 404 not found from MCP server. Does the MCP server support SSE?",
        );
        res.status(404).json(error);
        return;
      } else if (JSON.stringify(error).includes("ECONNREFUSED")) {
        console.error("Connection refused. Is the MCP server running?");
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
      console.log("Created client transport");
      if (serverTransport) {
        serverTransports.set(webAppTransport.sessionId, serverTransport);
      }
      console.log("Created server transport");

      // Handle cleanup when connection closes
      const handleConnectionClose = () => {
        console.log(
          `Connection closed for session ${webAppTransport.sessionId}`,
        );
        cleanupSession(webAppTransport.sessionId);
      };

      // Handle various connection termination scenarios
      res.on("close", handleConnectionClose);
      res.on("finish", handleConnectionClose);
      res.on("error", (error) => {
        console.error(
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
    console.error("Error in /sse route:", error);
    res.status(500).json(error);
  }
});

serverRouter.post("/message", async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    // console.log(`Received POST message for sessionId ${sessionId}`);

    const transport = webAppTransports.get(
      sessionId as string,
    ) as SSEServerTransport;
    if (!transport) {
      res.status(404).end("Session not found");
      return;
    }
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Error in /message route:", error);
    res.status(500).json(error);
  }
});

serverRouter.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

export default serverRouter;
