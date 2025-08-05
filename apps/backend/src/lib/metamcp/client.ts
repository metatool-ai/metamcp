import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ServerParameters } from "@repo/zod-types";

import { dockerManager } from "./docker-manager";
import { metamcpLogStore } from "./log-store";

const sleep = (time: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), time));

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  serverUuid: string;
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

/**
 * Creates a client for an MCP server based on its type
 */
export const createMetaMcpClient = (
  serverUuid: string,
  serverParams: ServerParameters,
): { client: Client | undefined; transport: Transport | undefined } => {
  let transport: Transport | undefined;

  // For STDIO servers, use Docker container URL
  if (!serverParams.type || serverParams.type === "STDIO") {
    const dockerUrl = dockerManager.getServerUrl(serverUuid);
    if (!dockerUrl) {
      metamcpLogStore.addLog(
        serverParams.name,
        "error",
        `No Docker container found for stdio server: ${serverUuid}`,
      );
      return { client: undefined, transport: undefined };
    }

    // Use Streamable HTTP for Docker containers
    transport = new StreamableHTTPClientTransport(new URL(dockerUrl));
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

/**
 * Connect to an MCP server without session management
 */
export const connectMetaMcpClient = async (
  serverUuid: string,
  serverParams: ServerParameters,
): Promise<ConnectedClient | undefined> => {
  const waitFor = 5000;
  const retries = 3;
  let count = 0;
  let retry = true;

  while (retry) {
    try {
      // Create fresh client and transport for each attempt
      const { client, transport } = createMetaMcpClient(
        serverUuid,
        serverParams,
      );
      if (!client || !transport) {
        return undefined;
      }

      await client.connect(transport);

      return {
        client,
        serverUuid,
        cleanup: async () => {
          await transport.close();
          await client.close();
        },
      };
    } catch (error) {
      metamcpLogStore.addLog(
        serverParams.name,
        "error",
        `Error connecting to MCP client (attempt ${count + 1}/${retries})`,
        error,
      );
      count++;
      retry = count < retries;
      if (retry) {
        await sleep(waitFor);
      }
    }
  }

  return undefined;
};
