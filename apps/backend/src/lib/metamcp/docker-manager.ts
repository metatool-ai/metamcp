import { ServerParameters } from "@repo/zod-types";
import Docker from "dockerode";

import { dockerSessionsRepo } from "../../db/repositories/docker-sessions.repo.js";

export interface DockerMcpServer {
  containerId: string;
  serverUuid: string;
  port: number;
  url: string;
  containerName: string;
}

export class DockerManager {
  private static instance: DockerManager | null = null;
  private docker: Docker;
  private runningServers: Map<string, DockerMcpServer> = new Map();
  private readonly BASE_PORT = 18000;
  private readonly MAX_PORTS = 1000;

  private constructor() {
    // Use DOCKER_HOST environment variable to communicate with host Docker
    const dockerHost = process.env.DOCKER_HOST || "unix:///var/run/docker.sock";

    if (dockerHost.startsWith("unix://")) {
      // For Unix socket connections, use socketPath
      this.docker = new Docker({
        socketPath: dockerHost.replace("unix://", ""),
      });
    } else if (dockerHost.startsWith("tcp://")) {
      // For TCP connections, parse the URL
      const url = new URL(dockerHost);
      const protocol = url.protocol.replace(":", "") as "http" | "https";
      this.docker = new Docker({
        host: url.hostname,
        port: parseInt(url.port) || 2376,
        protocol,
      });
    } else {
      // Fallback for other formats (assume it's a socket path)
      this.docker = new Docker({ socketPath: dockerHost });
    }
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): DockerManager {
    if (!DockerManager.instance) {
      DockerManager.instance = new DockerManager();
    }
    return DockerManager.instance;
  }

  /**
   * Find an available port for a new MCP server
   */
  private async findAvailablePort(): Promise<number> {
    return await dockerSessionsRepo.findAvailablePort(
      this.BASE_PORT,
      this.MAX_PORTS,
    );
  }

  /**
   * Create a Docker container for an MCP server
   */
  async createContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    // Check if already running in database
    const existingSession =
      await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (existingSession && existingSession.status === "running") {
      // Return existing session from database
      const existingServer: DockerMcpServer = {
        containerId: existingSession.container_id,
        serverUuid,
        port: existingSession.port,
        url: existingSession.url,
        containerName: existingSession.container_name,
      };
      this.runningServers.set(serverUuid, existingServer);
      return existingServer;
    }

    // Find and reserve an available port atomically
    let port: number = 18000;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      port = await this.findAvailablePort();
      const reserved = await dockerSessionsRepo.reservePort(port, serverUuid);
      if (reserved) {
        break;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        throw new Error("Could not reserve a port after multiple attempts");
      }
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const containerName = `metamcp-stdio-server-${serverUuid}`;

    // Check if container already exists
    try {
      const existingContainer = this.docker.getContainer(containerName);
      const containerInfo = await existingContainer.inspect();

      if (containerInfo.State.Running) {
        // Container exists and is running, reuse it
        const hostPort = parseInt(
          containerInfo.NetworkSettings.Ports["3000/tcp"]?.[0]?.HostPort || "0",
        );

        // Use host.docker.internal when running inside Docker container
        const isDockerContainer =
          process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL === "true";
        const serverUrl = isDockerContainer
          ? `http://host.docker.internal:${hostPort}/sse`
          : `http://localhost:${hostPort}/sse`;

        const existingServer: DockerMcpServer = {
          containerId: containerInfo.Id,
          serverUuid,
          port: hostPort,
          url: serverUrl,
          containerName,
        };

        this.runningServers.set(serverUuid, existingServer);
        console.log(
          `Reusing existing container for server ${serverUuid}:`,
          existingServer,
        );
        return existingServer;
      } else {
        // Container exists but not running, remove it
        try {
          await existingContainer.remove();
        } catch (error) {
          console.warn(
            `Could not remove existing stopped container ${containerName}:`,
            error,
          );
        }
      }
    } catch {
      // Container doesn't exist, will create new one
      console.log(
        `No existing container found for server ${serverUuid}, creating new one`,
      );
    }

    // Create container configuration
    const containerConfig = {
      Image: "mcp/server:latest",
      name: containerName,
      Env: [
        `MCP_SERVER_COMMAND=${serverParams.command || ""}`,
        `MCP_SERVER_ARGS=${JSON.stringify(serverParams.args || [])}`,
        `MCP_SERVER_ENV=${JSON.stringify(serverParams.env || {})}`,
      ],
      ExposedPorts: {
        "3000/tcp": {},
      },
      HostConfig: {
        PortBindings: {
          "3000/tcp": [{ HostPort: port.toString() }],
        },
        RestartPolicy: {
          Name: "unless-stopped",
        },
        // Ensure the container can be reached from the host
        ExtraHosts: ["host.docker.internal:host-gateway"],
      },
      Labels: {
        "metamcp.server.uuid": serverUuid,
        "metamcp.server.type": "stdio",
        "metamcp.managed": "true",
      },
    };

    try {
      const container = await this.docker.createContainer(containerConfig);
      await container.start();

      // Note: We're using port binding instead of network mode
      // The container will be accessible via host.docker.internal:port
      // No need to connect to a specific network

      // Wait a moment for the container to fully start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if container is running and healthy
      const containerInfo = await container.inspect();
      console.log(
        `Container ${container.id} status:`,
        containerInfo.State.Status,
      );

      // Use host.docker.internal when running inside Docker container
      const isDockerContainer =
        process.env.TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL === "true";

      // Test if the port is accessible
      const testUrl = isDockerContainer
        ? `http://host.docker.internal:${port}/sse`
        : `http://localhost:${port}/sse`;

      try {
        const response = await fetch(testUrl, {
          method: "GET",
          signal: AbortSignal.timeout(5000), // 5 second timeout
        });
        console.log(`Port ${port} is accessible, status: ${response.status}`);
      } catch (error) {
        console.warn(`Port ${port} is not yet accessible:`, error);
        // Wait a bit more and try again
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          const response = await fetch(testUrl, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
          });
          console.log(
            `Port ${port} is now accessible, status: ${response.status}`,
          );
        } catch (retryError) {
          console.error(
            `Port ${port} is still not accessible after retry:`,
            retryError,
          );
        }
      }

      const serverUrl = isDockerContainer
        ? `http://host.docker.internal:${port}/sse`
        : `http://localhost:${port}/sse`;

      // Create database session for the container
      await dockerSessionsRepo.createSession({
        mcp_server_uuid: serverUuid,
        container_id: container.id,
        container_name: containerName,
        port,
        url: serverUrl,
      });

      const dockerServer: DockerMcpServer = {
        containerId: container.id,
        serverUuid,
        port,
        url: serverUrl,
        containerName,
      };

      console.log(`Created Docker container for server ${serverUuid}:`, {
        containerId: container.id,
        port,
        url: dockerServer.url,
        containerName,
      });

      this.runningServers.set(serverUuid, dockerServer);
      return dockerServer;
    } catch (error) {
      console.error(
        `Error creating container for server ${serverUuid}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Remove a Docker container for an MCP server
   */
  async removeContainer(serverUuid: string): Promise<void> {
    // Check database first
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    if (!session) {
      return;
    }

    const server = this.runningServers.get(serverUuid);

    try {
      const container = this.docker.getContainer(session.container_id);

      try {
        await container.stop();
      } catch (error) {
        // Container might already be stopped
        console.warn(
          `Could not stop container ${session.container_id}:`,
          error,
        );
      }

      try {
        await container.remove();
      } catch (error) {
        // Container might already be removed
        console.warn(
          `Could not remove container ${session.container_id}:`,
          error,
        );
      }

      // Update database session status
      await dockerSessionsRepo.stopSession(session.uuid);

      this.runningServers.delete(serverUuid);
      console.log(`Removed container for server ${serverUuid}`);
    } catch (error) {
      console.error(
        `Error removing container for server ${serverUuid}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get the URL for a Dockerized MCP server
   */
  async getServerUrl(serverUuid: string): Promise<string | undefined> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    return session?.url;
  }

  /**
   * Get all running Dockerized MCP servers
   */
  async getRunningServers(): Promise<DockerMcpServer[]> {
    const sessions = await dockerSessionsRepo.getRunningSessions();
    return sessions.map((session) => ({
      containerId: session.container_id,
      serverUuid: session.mcp_server_uuid,
      port: session.port,
      url: session.url,
      containerName: session.container_name,
    }));
  }

  /**
   * Check if a server is running
   */
  async isServerRunning(serverUuid: string): Promise<boolean> {
    const session = await dockerSessionsRepo.getSessionByMcpServer(serverUuid);
    return session?.status === "running";
  }

  /**
   * Update a server configuration (remove and recreate)
   */
  async updateServer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    await this.removeContainer(serverUuid);
    return await this.createContainer(serverUuid, serverParams);
  }

  /**
   * Clean up all running containers
   */
  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.runningServers.keys()).map((uuid) =>
      this.removeContainer(uuid),
    );
    await Promise.allSettled(cleanupPromises);
    this.runningServers.clear();
  }

  /**
   * Initialize containers for all stdio MCP servers
   */
  async initializeContainers(
    serverParams: Record<string, ServerParameters>,
  ): Promise<void> {
    const stdioServers = Object.entries(serverParams).filter(
      ([_, params]) => !params.type || params.type === "STDIO",
    );

    const initPromises = stdioServers.map(([uuid, params]) =>
      this.createContainer(uuid, params),
    );

    await Promise.allSettled(initPromises);
  }
}

// Create a singleton instance
export const dockerManager = DockerManager.getInstance();
