import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ServerParameters } from "@repo/zod-types";

import { RestApiMcpServer } from "../rest-api/rest-api-server";
import { ProcessManagedStdioTransport } from "../stdio-transport/process-managed-transport";
import { metamcpLogStore } from "./log-store";
import { serverErrorTracker } from "./server-error-tracker";
import { resolveEnvVariables, RestApiServerParameters } from "./utils";

// Error classes for better error handling
export class McpClientError extends Error {
  constructor(
    message: string,
    public readonly serverName: string,
    public readonly serverType: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "McpClientError";
  }
}

export class RestApiClientError extends McpClientError {
  constructor(message: string, serverName: string, cause?: Error) {
    super(message, serverName, "REST_API", cause);
    this.name = "RestApiClientError";
  }
}

const sleep = (time: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), time));

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void;
}

export interface RestApiConnectedClient {
  restApiServer: RestApiMcpServer;
  cleanup: () => Promise<void>;
}

export type AnyConnectedClient = ConnectedClient | RestApiConnectedClient;

// Result types for better error handling
export type ClientConnectionResult<T> =
  | { success: true; client: T }
  | { success: false; error: McpClientError };

export type RestApiConnectionResult = ClientConnectionResult<RestApiConnectedClient>;
export type StandardConnectionResult = ClientConnectionResult<ConnectedClient>;

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

/**
 * Creates a REST API client with proper error handling
 * @param serverParams Server parameters
 * @returns RestApiConnectedClient or throws McpClientError
 */
export const createRestApiClient = (
  serverParams: ServerParameters,
): RestApiConnectedClient => {
  if (serverParams.type !== "REST_API") {
    throw new McpClientError(
      `Invalid server type for REST API client: ${serverParams.type}`,
      serverParams.name,
      serverParams.type
    );
  }

  try {
    // Validate that we have the required REST API parameters
    const restApiParams = serverParams as RestApiServerParameters;
    if (!restApiParams.base_url || !restApiParams.api_spec) {
      throw new RestApiClientError(
        "Missing required REST API parameters: base_url and api_spec are required",
        serverParams.name
      );
    }

    const restApiServer = new RestApiMcpServer(restApiParams);

    return {
      restApiServer,
      cleanup: async () => {
        try {
          // Clean up the generated server file
          await restApiServer.cleanup();
          console.log(`Cleaned up REST API server: ${serverParams.name}`);
        } catch (cleanupError) {
          const errorMessage = cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';
          metamcpLogStore.addLog(
            serverParams.name,
            "error",
            `Failed to cleanup REST API server: ${errorMessage}`,
          );
          throw new RestApiClientError(
            `Cleanup failed: ${errorMessage}`,
            serverParams.name,
            cleanupError instanceof Error ? cleanupError : undefined
          );
        }
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    metamcpLogStore.addLog(
      serverParams.name,
      "error",
      `Failed to create REST API server: ${errorMessage}`,
    );

    if (error instanceof RestApiClientError || error instanceof McpClientError) {
      throw error;
    }

    throw new RestApiClientError(
      `Failed to create REST API server: ${errorMessage}`,
      serverParams.name,
      error instanceof Error ? error : undefined
    );
  }
};

/**
 * Safe version of createRestApiClient that returns a result type instead of throwing
 * @param serverParams Server parameters
 * @returns RestApiConnectionResult with success/error information
 */
export const createRestApiClientSafe = (
  serverParams: ServerParameters,
): RestApiConnectionResult => {
  try {
    const client = createRestApiClient(serverParams);
    return { success: true, client };
  } catch (error) {
    if (error instanceof McpClientError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new RestApiClientError(
        error instanceof Error ? error.message : 'Unknown error',
        serverParams.name,
        error instanceof Error ? error : undefined
      )
    };
  }
};

export const createMetaMcpClient = (
  serverParams: ServerParameters,
): { client: Client | undefined; transport: Transport | undefined } => {
  let transport: Transport | undefined;

  // Handle REST API servers separately
  if (serverParams.type === "REST_API") {
    // REST API servers don't use the standard client/transport pattern
    return { client: undefined, transport: undefined };
  }

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

    // Check for authentication - prioritize OAuth tokens, fallback to bearerToken
    const hasAuth =
      serverParams.oauth_tokens?.access_token || serverParams.bearerToken;

    if (!hasAuth) {
      transport = new SSEClientTransport(new URL(transformedUrl));
    } else {
      const headers: Record<string, string> = {};

      // Use OAuth access token if available, otherwise use bearerToken
      const authToken =
        serverParams.oauth_tokens?.access_token || serverParams.bearerToken;
      headers["Authorization"] = `Bearer ${authToken}`;

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

    // Check for authentication - prioritize OAuth tokens, fallback to bearerToken
    const hasAuth =
      serverParams.oauth_tokens?.access_token || serverParams.bearerToken;

    if (!hasAuth) {
      transport = new StreamableHTTPClientTransport(new URL(transformedUrl));
    } else {
      const headers: Record<string, string> = {};

      // Use OAuth access token if available, otherwise use bearerToken
      const authToken =
        serverParams.oauth_tokens?.access_token || serverParams.bearerToken;
      headers["Authorization"] = `Bearer ${authToken}`;

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
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
      },
    },
  );
  return { client, transport };
};

export const connectRestApiClient = async (
  serverParams: ServerParameters,
): Promise<RestApiConnectedClient | undefined> => {
  if (serverParams.type !== "REST_API") {
    return undefined;
  }

  try {
    const restApiClient = createRestApiClient(serverParams);
    if (!restApiClient) {
      return undefined;
    }

    // Test the connection
    const testResult = await restApiClient.restApiServer.testConnection();
    if (!testResult.success) {
      console.warn(`REST API connection test failed for ${serverParams.name}: ${testResult.message}`);
      // Don't fail completely - the API might still work for actual requests
    }

    console.log(`Successfully connected to REST API server: ${serverParams.name}`);
    return restApiClient;
  } catch (error) {
    console.error(`Failed to connect to REST API server ${serverParams.name}:`, error);
    return undefined;
  }
};

export const connectAnyMcpClient = async (
  serverParams: ServerParameters,
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void,
): Promise<AnyConnectedClient | undefined> => {
  if (serverParams.type === "REST_API") {
    return await connectRestApiClient(serverParams);
  } else {
    return await connectMetaMcpClient(serverParams, onProcessCrash);
  }
};

export const connectMetaMcpClient = async (
  serverParams: ServerParameters,
  onProcessCrash?: (exitCode: number | null, signal: string | null) => void,
): Promise<ConnectedClient | undefined> => {
  // Don't handle REST API servers here
  if (serverParams.type === "REST_API") {
    return undefined;
  }

  const waitFor = 5000;

  // Get max attempts from server error tracker instead of hardcoding
  const maxAttempts = await serverErrorTracker.getServerMaxAttempts(
    serverParams.uuid,
  );
  let count = 0;
  let retry = true;

  console.log(
    `Connecting to server ${serverParams.name} (${serverParams.uuid}) with max attempts: ${maxAttempts}`,
  );

  while (retry) {
    try {
      // Check if server is already in error state before attempting connection
      const isInErrorState = await serverErrorTracker.isServerInErrorState(
        serverParams.uuid,
      );
      if (isInErrorState) {
        console.warn(
          `Server ${serverParams.name} (${serverParams.uuid}) is already in ERROR state, skipping connection attempt`,
        );
        return undefined;
      }

      // Create fresh client and transport for each attempt
      const { client, transport } = createMetaMcpClient(serverParams);
      if (!client || !transport) {
        return undefined;
      }

      // Set up process crash detection for STDIO transports BEFORE connecting
      if (transport instanceof ProcessManagedStdioTransport) {
        console.log(
          `Setting up crash handler for server ${serverParams.name} (${serverParams.uuid})`,
        );
        transport.onprocesscrash = (exitCode, signal) => {
          console.warn(
            `Process crashed for server ${serverParams.name} (${serverParams.uuid}): code=${exitCode}, signal=${signal}`,
          );

          // Notify the pool about the crash
          if (onProcessCrash) {
            console.log(
              `Calling onProcessCrash callback for server ${serverParams.name} (${serverParams.uuid})`,
            );
            onProcessCrash(exitCode, signal);
          } else {
            console.warn(
              `No onProcessCrash callback provided for server ${serverParams.name} (${serverParams.uuid})`,
            );
          }
        };
      }

      await client.connect(transport);

      return {
        client,
        cleanup: async () => {
          await transport.close();
          await client.close();
        },
        onProcessCrash: (exitCode, signal) => {
          console.warn(
            `Process crash detected for server ${serverParams.name} (${serverParams.uuid}): code=${exitCode}, signal=${signal}`,
          );

          // Notify the pool about the crash
          if (onProcessCrash) {
            onProcessCrash(exitCode, signal);
          }
        },
      };
    } catch (error) {
      metamcpLogStore.addLog(
        "client",
        "error",
        `Error connecting to MetaMCP client (attempt ${count + 1}/${maxAttempts})`,
        error,
      );
      count++;
      retry = count < maxAttempts;
      if (retry) {
        await sleep(waitFor);
      }
    }
  }

  return undefined;
};
