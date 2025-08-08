import { ServerParameters } from "@repo/zod-types";

import { dockerSessionsRepo, mcpServersRepository } from "../db/repositories";
import { dockerManager } from "./metamcp/docker-manager/index.js";
import { convertDbServerToParams } from "./metamcp/utils";

// Store the interval ID for potential cleanup
let periodicSyncInterval: NodeJS.Timeout | null = null;

/**
 * Startup function to initialize Docker containers for stdio MCP servers
 */
export async function initializeDockerContainers() {
  try {
    console.log("Initializing Docker containers for stdio MCP servers...");

    // Clean up any leftover temporary sessions from previous failed attempts
    console.log("Cleaning up temporary sessions...");
    const cleanedCount = await dockerSessionsRepo.cleanupTemporarySessions();
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} temporary sessions`);
    }

    // First, sync any existing container statuses to fix discrepancies
    console.log("Syncing existing container statuses...");
    const { syncedCount, totalCount } =
      await dockerManager.syncAllContainerStatuses();
    if (syncedCount > 0) {
      console.log(
        `Fixed ${syncedCount} out of ${totalCount} container status discrepancies`,
      );
    }

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

    // Start periodic container status synchronization
    periodicSyncInterval = dockerManager.startPeriodicSync(30000); // Sync every 30 seconds
    console.log("✅ Started periodic container status synchronization");

    console.log(
      "✅ Successfully initialized Docker containers for all MCP servers",
    );
  } catch (error) {
    console.error("❌ Error initializing Docker containers:", error);
    // Don't exit the process, just log the error
    // The server should still start even if Docker initialization fails
  }
}

/**
 * Cleanup function to stop periodic sync
 */
export function cleanupDockerSync() {
  if (periodicSyncInterval) {
    dockerManager.stopPeriodicSync(periodicSyncInterval);
    periodicSyncInterval = null;
  }
}
