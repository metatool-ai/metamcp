import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  SSEClientTransportOptions,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CancelledNotificationSchema,
  ClientNotification,
  ClientRequest,
  CompleteResultSchema,
  CreateMessageRequestSchema,
  ErrorCode,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  McpError,
  Progress,
  PromptListChangedNotificationSchema,
  PromptReference,
  Request,
  ResourceListChangedNotificationSchema,
  ResourceReference,
  ResourceUpdatedNotificationSchema,
  Result,
  ServerCapabilities,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { McpServerType, McpServerTypeEnum } from "@repo/zod-types";
import { useMemoizedFn } from "ahooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { SESSION_KEYS } from "@/lib/constants";

import { ConnectionStatus } from "../lib/constants";
import { getAppUrl } from "../lib/env";
import {
  Notification,
  StdErrNotificationSchema,
} from "../lib/notificationTypes";
import { createAuthProvider } from "../lib/oauth-provider";

interface UseConnectionOptions {
  mcpServerUuid: string;
  transportType: McpServerType;
  command: string;
  args: string;
  url: string;
  env: Record<string, string>;
  bearerToken?: string;
  headerName?: string;
  onNotification?: (notification: Notification) => void;
  onStdErrNotification?: (notification: Notification) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPendingRequest?: (request: any, resolve: any, reject: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRoots?: () => any[];
  isMetaMCP?: boolean;
  includeInactiveServers?: boolean;
  enabled?: boolean; // Skip hook execution when false
}

export function useConnection({
  mcpServerUuid,
  transportType,
  command,
  args,
  url,
  env,
  bearerToken,
  headerName,
  onNotification,
  onStdErrNotification,
  onPendingRequest,
  getRoots,
  isMetaMCP = false,
  includeInactiveServers = false,
  enabled = true,
}: UseConnectionOptions) {
  const authProvider = createAuthProvider(mcpServerUuid, url);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [serverCapabilities, setServerCapabilities] =
    useState<ServerCapabilities | null>(null);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [clientTransport, setClientTransport] = useState<Transport | null>(
    null,
  );
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);
  const [completionsSupported, setCompletionsSupported] = useState(true);

  const pushHistory = useMemoizedFn((request: object, response?: object) => {
    setRequestHistory((prev) => [
      ...prev,
      {
        request: JSON.stringify(request),
        response: response !== undefined ? JSON.stringify(response) : undefined,
      },
    ]);
  });

  const makeRequest = useMemoizedFn(
    async <T extends z.ZodType>(
      request: ClientRequest,
      schema: T,
      options?: RequestOptions & { suppressToast?: boolean },
    ): Promise<z.output<T>> => {
      if (!mcpClient) {
        throw new Error("MCP client not connected");
      }
      try {
        const abortController = new AbortController();

        // prepare MCP Client request options
        // TODO: add configurable options e.g., max time out
        const mcpRequestOptions: RequestOptions = {
          signal: options?.signal ?? abortController.signal,
          resetTimeoutOnProgress: options?.resetTimeoutOnProgress ?? true,
          timeout: options?.timeout ?? 60000,
          maxTotalTimeout: options?.maxTotalTimeout ?? 60000,
        };

        // If progress notifications are enabled, add an onprogress hook to the MCP Client request options
        // This is required by SDK to reset the timeout on progress notifications
        if (mcpRequestOptions.resetTimeoutOnProgress) {
          mcpRequestOptions.onprogress = (params: Progress) => {
            // Add progress notification to `Server Notification` window in the UI
            if (onNotification) {
              onNotification({
                method: "notification/progress",
                params,
              });
            }
          };
        }

        let response;
        try {
          response = await mcpClient.request(
            request,
            schema,
            mcpRequestOptions,
          );

          pushHistory(request, response);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          pushHistory(request, { error: errorMessage });
          throw error;
        }

        return response;
      } catch (e: unknown) {
        if (!options?.suppressToast) {
          const errorString = (e as Error).message ?? String(e);
          toast.error(errorString);
        }
        throw e;
      }
    },
  );

  const handleCompletion = useMemoizedFn(
    async (
      ref: ResourceReference | PromptReference,
      argName: string,
      value: string,
      signal?: AbortSignal,
    ): Promise<string[]> => {
      if (!mcpClient || !completionsSupported) {
        return [];
      }

      const request: ClientRequest = {
        method: "completion/complete",
        params: {
          argument: {
            name: argName,
            value,
          },
          ref,
        },
      };

      try {
        const response = await makeRequest(request, CompleteResultSchema, {
          signal,
          suppressToast: true,
        });
        return response?.completion.values || [];
      } catch (e: unknown) {
        // Disable completions silently if the server doesn't support them.
        // See https://github.com/modelcontextprotocol/specification/discussions/122
        if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
          setCompletionsSupported(false);
          return [];
        }

        // Unexpected errors - show toast and rethrow
        toast.error(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
  );

  const sendNotification = useMemoizedFn(
    async (notification: ClientNotification) => {
      if (!mcpClient) {
        const error = new Error("MCP client not connected");
        toast.error(error.message);
        throw error;
      }

      try {
        await mcpClient.notification(notification);
        // Log successful notifications
        pushHistory(notification);
      } catch (e: unknown) {
        if (e instanceof McpError) {
          // Log MCP protocol errors
          pushHistory(notification, { error: e.message });
        }
        toast.error(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
  );

  const checkProxyHealth = useMemoizedFn(async () => {
    try {
      const proxyHealthUrl = new URL(`/mcp-proxy/server/health`, getAppUrl());

      // Cookies will be sent automatically by the browser
      const proxyHealthResponse = await fetch(proxyHealthUrl, {
        credentials: "include", // Ensure cookies are sent
      });
      const proxyHealth = await proxyHealthResponse.json();
      if (proxyHealth?.status !== "ok") {
        throw new Error("MCP Proxy Server is not healthy");
      }
    } catch (e) {
      console.error("Couldn't connect to MCP Proxy Server", e);
      throw e;
    }
  });

  const is401Error = useMemoizedFn((error: unknown): boolean => {
    return Boolean(
      (error instanceof SseError && error.code === 401) ||
        (error instanceof Error && error.message.includes("401")) ||
        (error instanceof Error && error.message.includes("Unauthorized")) ||
        // Handle fetch errors that might come from streamable HTTP
        (error instanceof TypeError && error.message.includes("401")) ||
        // Handle response errors
        (error &&
          typeof error === "object" &&
          "status" in error &&
          (error as { status: number }).status === 401),
    );
  });

  const isProxyAuthError = useMemoizedFn((error: unknown): boolean => {
    return (
      error instanceof Error &&
      error.message.includes("Authentication required. Use the session token")
    );
  });

  const handleAuthError = useMemoizedFn(async (error: unknown) => {
    if (is401Error(error)) {
      sessionStorage.setItem(SESSION_KEYS.SERVER_URL, url || "");
      sessionStorage.setItem(SESSION_KEYS.MCP_SERVER_UUID, mcpServerUuid);

      const result = await auth(authProvider, {
        serverUrl: url || "",
      });
      return result === "AUTHORIZED";
    }
    return false;
  });

  const connect = useMemoizedFn(
    async (_e?: unknown, retryCount: number = 0): Promise<void> => {
      // Skip connection if hook is disabled
      if (!enabled) {
        console.warn("Cannot connect: useConnection hook is disabled");
        setConnectionStatus("disconnected");
        return;
      }

      // For MetaMCP connections, we don't need server data
      if (!isMetaMCP) {
        // Ensure transportType is defined
        if (!transportType) {
          console.error(
            "Cannot connect: Transport type not defined or not fetched",
          );
          setConnectionStatus("error");
          return;
        }
      }

      const client = new Client<Request, Notification, Result>(
        {
          name: "metamcp-proxy",
          version: "2.0.0",
        },
        {
          capabilities: {
            sampling: {},
            roots: {
              listChanged: true,
            },
          },
        },
      );

      try {
        await checkProxyHealth();
      } catch {
        setConnectionStatus("error-connecting-to-proxy");
        return;
      }

      try {
        // Inject auth manually instead of using SSEClientTransport, because we're
        // proxying through the inspector server first.
        const headers: HeadersInit = {};

        // Use manually provided bearer token if available, otherwise use OAuth tokens
        const token =
          bearerToken || (await authProvider.tokens())?.access_token;
        if (token) {
          const authHeaderName = headerName || "Authorization";

          // Add custom header name as a special request header to let the server know which header to pass through
          if (authHeaderName.toLowerCase() !== "authorization") {
            headers[authHeaderName] = token;
            headers["x-custom-auth-header"] = authHeaderName;
          } else {
            headers[authHeaderName] = `Bearer ${token}`;
          }
        }

        // Create appropriate transport
        let transportOptions:
          | StreamableHTTPClientTransportOptions
          | SSEClientTransportOptions;

        let mcpProxyServerUrl: URL;

        // Handle MetaMCP connections
        if (isMetaMCP) {
          // For MetaMCP, we use SSE connection to the metamcp proxy endpoint
          mcpProxyServerUrl = new URL(url, getAppUrl());
          // Add includeInactiveServers as a query parameter
          if (includeInactiveServers) {
            mcpProxyServerUrl.searchParams.append(
              "includeInactiveServers",
              "true",
            );
          }
          transportOptions = {
            eventSourceInit: {
              fetch: (
                url: string | URL | globalThis.Request,
                init?: RequestInit,
              ) =>
                fetch(url, {
                  ...init,
                  headers,
                  credentials: "include",
                }),
            },
            requestInit: {
              headers,
              credentials: "include",
            },
          };
        } else {
          switch (transportType) {
            case McpServerTypeEnum.Enum.STDIO:
              mcpProxyServerUrl = new URL(
                `/mcp-proxy/server/stdio`,
                getAppUrl(),
              );
              mcpProxyServerUrl.searchParams.append("command", command);
              mcpProxyServerUrl.searchParams.append("args", args);
              mcpProxyServerUrl.searchParams.append("env", JSON.stringify(env));
              transportOptions = {
                authProvider: authProvider,
                eventSourceInit: {
                  fetch: (
                    url: string | URL | globalThis.Request,
                    init?: RequestInit,
                  ) =>
                    fetch(url, {
                      ...init,
                      headers,
                      credentials: "include",
                    }),
                },
                requestInit: {
                  headers,
                  credentials: "include",
                },
                // TODO these should be configurable...
                reconnectionOptions: {
                  maxReconnectionDelay: 30000,
                  initialReconnectionDelay: 1000,
                  reconnectionDelayGrowFactor: 1.5,
                  maxRetries: 2,
                },
              };
              break;

            case McpServerTypeEnum.Enum.SSE:
              mcpProxyServerUrl = new URL(`/mcp-proxy/server/sse`, getAppUrl());
              mcpProxyServerUrl.searchParams.append("url", url);
              transportOptions = {
                eventSourceInit: {
                  fetch: (
                    url: string | URL | globalThis.Request,
                    init?: RequestInit,
                  ) =>
                    fetch(url, {
                      ...init,
                      headers,
                      credentials: "include",
                    }),
                },
                requestInit: {
                  headers,
                  credentials: "include",
                },
                // TODO these should be configurable...
                reconnectionOptions: {
                  maxReconnectionDelay: 30000,
                  initialReconnectionDelay: 1000,
                  reconnectionDelayGrowFactor: 1.5,
                  maxRetries: 2,
                },
              };
              break;

            case McpServerTypeEnum.Enum.STREAMABLE_HTTP:
              mcpProxyServerUrl = new URL(`/mcp-proxy/server/mcp`, getAppUrl());
              mcpProxyServerUrl.searchParams.append("url", url);
              transportOptions = {
                authProvider: authProvider,
                eventSourceInit: {
                  fetch: (
                    url: string | URL | globalThis.Request,
                    init?: RequestInit,
                  ) =>
                    fetch(url, {
                      ...init,
                      headers,
                      credentials: "include",
                    }),
                },
                requestInit: {
                  headers,
                  credentials: "include",
                },
                // TODO these should be configurable...
                reconnectionOptions: {
                  maxReconnectionDelay: 30000,
                  initialReconnectionDelay: 1000,
                  reconnectionDelayGrowFactor: 1.5,
                  maxRetries: 2,
                },
              };
              break;

            default:
              console.error(`Unsupported transport type: ${transportType}`);
              setConnectionStatus("error");
              return;
          }

          mcpProxyServerUrl.searchParams.append("transportType", transportType);
        }

        if (onNotification) {
          [
            CancelledNotificationSchema,
            LoggingMessageNotificationSchema,
            ResourceUpdatedNotificationSchema,
            ResourceListChangedNotificationSchema,
            ToolListChangedNotificationSchema,
            PromptListChangedNotificationSchema,
          ].forEach((notificationSchema) => {
            client.setNotificationHandler(notificationSchema, onNotification);
          });

          client.fallbackNotificationHandler = (
            notification: Notification,
          ): Promise<void> => {
            onNotification(notification);
            return Promise.resolve();
          };
        }

        if (onStdErrNotification) {
          client.setNotificationHandler(
            StdErrNotificationSchema,
            onStdErrNotification,
          );
        }

        let capabilities;
        try {
          const transport = isMetaMCP
            ? new SSEClientTransport(mcpProxyServerUrl, transportOptions)
            : transportType === McpServerTypeEnum.Enum.STREAMABLE_HTTP
              ? new StreamableHTTPClientTransport(mcpProxyServerUrl, {
                  sessionId: undefined,
                  ...transportOptions,
                })
              : new SSEClientTransport(mcpProxyServerUrl, transportOptions);

          await client.connect(transport as Transport);

          setClientTransport(transport);

          capabilities = client.getServerCapabilities();
          const initializeRequest = {
            method: "initialize",
          };
          pushHistory(initializeRequest, {
            capabilities,
            serverInfo: client.getServerVersion(),
            instructions: client.getInstructions(),
          });
        } catch (error) {
          console.error(
            `Failed to connect to MCP Server via the MCP Inspector Proxy: ${mcpProxyServerUrl}:`,
            error,
          );

          // Check if it's a proxy auth error
          if (isProxyAuthError(error)) {
            toast.error(
              "Please enter the session token from the proxy server console in the Configuration settings.",
            );
            setConnectionStatus("error");
            return;
          }

          const shouldRetry = await handleAuthError(error);
          if (shouldRetry) {
            return connect(undefined, retryCount + 1);
          }
          if (is401Error(error)) {
            // Don't set error state if we're about to redirect for auth

            return;
          }
          throw error;
        }
        setServerCapabilities(capabilities ?? null);
        setCompletionsSupported(true); // Reset completions support on new connection

        if (onPendingRequest) {
          client.setRequestHandler(CreateMessageRequestSchema, (request) => {
            return new Promise((resolve, reject) => {
              onPendingRequest(request, resolve, reject);
            });
          });
        }

        if (getRoots) {
          client.setRequestHandler(ListRootsRequestSchema, async () => {
            return { roots: getRoots() };
          });
        }

        setMcpClient(client);
        setConnectionStatus("connected");
      } catch (e) {
        console.error(e);
        setConnectionStatus("error");
      }
    },
  );

  const disconnect = useMemoizedFn(async () => {
    try {
      if (
        transportType === McpServerTypeEnum.Enum.STREAMABLE_HTTP &&
        clientTransport
      ) {
        await (
          clientTransport as StreamableHTTPClientTransport
        ).terminateSession();
      }
      if (mcpClient) {
        await mcpClient.close();
      }
      if (enabled) {
        // Only clear auth provider if hook is enabled (to avoid clearing when just disabled)
        authProvider.clear();
      }
    } catch (error) {
      console.error("Error during disconnect:", error);
    } finally {
      setMcpClient(null);
      setClientTransport(null);
      setConnectionStatus("disconnected");
      setCompletionsSupported(false);
      setServerCapabilities(null);
    }
  });

  // Handle enabled/disabled state changes
  useEffect(() => {
    if (!enabled && connectionStatus === "connected") {
      // Disconnect when hook becomes disabled
      disconnect();
    }
  }, [enabled, connectionStatus, disconnect]);

  // Cleanup handlers for component unmount and browser navigation
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Attempt to close connection gracefully before page unload
      if (connectionStatus === "connected") {
        disconnect();
      }
    };

    const handleUnload = () => {
      // Final cleanup on actual page unload (refresh, close, navigate away)
      if (connectionStatus === "connected") {
        disconnect();
      }
    };

    // Add event listeners for browser navigation
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("unload", handleUnload);

    // Cleanup on component unmount
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("unload", handleUnload);
      if (connectionStatus === "connected") {
        disconnect();
      }
    };
  }, [connectionStatus, disconnect]);

  return {
    connectionStatus,
    serverCapabilities,
    mcpClient,
    requestHistory,
    makeRequest,
    sendNotification,
    handleCompletion,
    completionsSupported,
    connect,
    disconnect,
  };
}
