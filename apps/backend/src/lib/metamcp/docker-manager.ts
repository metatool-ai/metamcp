import { ServerParameters } from "@repo/zod-types";
import { randomUUID } from "crypto";
import Docker from "dockerode";

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
    this.docker = new Docker({ host: dockerHost });
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
    const containers = await this.docker.listContainers({ all: true });
    const usedPorts = new Set<number>();

    containers.forEach((container) => {
      container.Ports?.forEach((port) => {
        if (port.PublicPort) {
          usedPorts.add(port.PublicPort);
        }
      });
    });

    for (
      let port = this.BASE_PORT;
      port < this.BASE_PORT + this.MAX_PORTS;
      port++
    ) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error("No available ports for MCP server containers");
  }

  /**
   * Create a Docker container for an MCP server
   */
  async createContainer(
    serverUuid: string,
    serverParams: ServerParameters,
  ): Promise<DockerMcpServer> {
    // Check if already running
    const existing = this.runningServers.get(serverUuid);
    if (existing) {
      return existing;
    }

    const port = await this.findAvailablePort();
    const containerName = `metamcp-stdio-server-${serverUuid}-${randomUUID().slice(0, 8)}`;

    // Create container configuration
    const containerConfig = {
      Image: process.env.MCP_SERVER_DOCKER_IMAGE || "mcp/server:latest",
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
        NetworkMode: "host", // Use host networking for simplicity
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

      const dockerServer: DockerMcpServer = {
        containerId: container.id,
        serverUuid,
        port,
        url: `http://localhost:${port}`,
        containerName,
      };

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
    const server = this.runningServers.get(serverUuid);
    if (!server) {
      return;
    }

    try {
      const container = this.docker.getContainer(server.containerId);

      try {
        await container.stop();
      } catch (error) {
        // Container might already be stopped
        console.warn(`Could not stop container ${server.containerId}:`, error);
      }

      try {
        await container.remove();
      } catch (error) {
        // Container might already be removed
        console.warn(
          `Could not remove container ${server.containerId}:`,
          error,
        );
      }

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
  getServerUrl(serverUuid: string): string | undefined {
    const server = this.runningServers.get(serverUuid);
    return server?.url;
  }

  /**
   * Get all running Dockerized MCP servers
   */
  getRunningServers(): DockerMcpServer[] {
    return Array.from(this.runningServers.values());
  }

  /**
   * Check if a server is running
   */
  isServerRunning(serverUuid: string): boolean {
    return this.runningServers.has(serverUuid);
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
