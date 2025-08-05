import { ServerParameters } from "@repo/zod-types";

import { mcpServersRepository, namespacesRepository } from "../db/repositories";
import { convertDbServerToParams } from "./metamcp/utils";
import { dockerManager } from "./metamcp/docker-manager";

/**
 * Startup function to initialize Docker containers for all MCP servers
 * (Previously managed idle servers, now focuses on Docker container initialization)
 */
export async function initializeIdleServers() {
  try {
    console.log(
      "Initializing idle servers for all namespaces and all MCP servers...",
    );

    // Fetch all namespaces from the database
    const namespaces = await namespacesRepository.findAll();
    const namespaceUuids = namespaces.map((namespace) => namespace.uuid);

    if (namespaceUuids.length === 0) {
      console.log("No namespaces found in database");
    } else {
      console.log(
        `Found ${namespaceUuids.length} namespaces: ${namespaceUuids.join(", ")}`,
      );
    }

    // Fetch ALL MCP servers from the database (not just namespace-associated ones)
    console.log("Fetching all MCP servers from database...");
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


    console.log(
      "✅ Successfully completed startup initialization for all MCP servers",
    );
  } catch (error) {
    console.error("❌ Error initializing idle servers:", error);
    // Don't exit the process, just log the error
    // The server should still start even if idle server initialization fails
  }
}

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
