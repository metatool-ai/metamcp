import Docker from "dockerode";

/**
 * Handles Docker network management for MetaMCP
 */
export class NetworkManager {
  private docker: Docker;
  private readonly NETWORK_NAME = "metamcp_metamcp-internal";

  constructor(docker: Docker) {
    this.docker = docker;
  }

  /**
   * Ensure the internal network exists
   */
  async ensureNetworkExists(): Promise<void> {
    try {
      // Try to get the network
      const network = this.docker.getNetwork(this.NETWORK_NAME);
      await network.inspect();
      console.log(`Network ${this.NETWORK_NAME} already exists`);
    } catch {
      // Network doesn't exist, create it
      console.log(`Creating network ${this.NETWORK_NAME}`);
      try {
        await this.docker.createNetwork({
          Name: this.NETWORK_NAME,
          Driver: "bridge",
          Internal: true, // Make it internal so it's not accessible from outside
          Labels: {
            "metamcp.managed": "true",
          },
        });
        console.log(`Created network ${this.NETWORK_NAME}`);
      } catch (createError) {
        // If creation fails, the network might have been created by docker-compose
        // Try to inspect it again
        try {
          const network = this.docker.getNetwork(this.NETWORK_NAME);
          await network.inspect();
          console.log(
            `Network ${this.NETWORK_NAME} exists (created by docker-compose)`,
          );
        } catch {
          console.error(
            `Failed to create or find network ${this.NETWORK_NAME}:`,
            createError,
          );
          throw createError;
        }
      }
    }
  }

  getNetworkName(): string {
    return this.NETWORK_NAME;
  }
}
