import { ServerParameters } from "@repo/zod-types";

import { mcpServersRepository } from "../db/repositories";
import { dockerManager } from "./metamcp/docker-manager";
import { convertDbServerToParams } from "./metamcp/utils";

/**
 * Startup function to initialize Docker containers for stdio MCP servers
 */
export async function initializeDockerContainers() {
  try {
    console.log("Initializing Docker containers for stdio MCP servers...");

    // Fetch all MCP servers from the database
    const allDbServers = await mcpServersRepository.findAll();
    console.log(`Found ${allDbServers.length} total MCP servers in database`);

    // Convert all database servers to ServerParameters format
    const allServerParams: Record<string, ServerParameters> = {};
    for (const dbServer of allDbServers) {
      const serverParams = await convertDbServerToParams(dbServer);
      if (serverParams) {
        allServerParams[dbServer.uuid] = serverParams;
      }
    }

    console.log(
      `Successfully converted ${Object.keys(allServerParams).length} MCP servers to ServerParameters format`,
    );

    // Initialize Docker containers for stdio servers
    if (Object.keys(allServerParams).length > 0) {
      await dockerManager.initializeContainers(allServerParams);
      console.log(
        "✅ Successfully initialized Docker containers for stdio MCP servers",
      );
    }

    console.log(
      "✅ Successfully initialized Docker containers for all MCP servers",
    );
  } catch (error) {
    console.error("❌ Error initializing Docker containers:", error);
    // Don't exit the process, just log the error
    // The server should still start even if Docker initialization fails
  }
}
