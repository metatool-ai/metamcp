import { ServerParameters } from "@repo/zod-types";

import { mcpServersRepository, namespacesRepository } from "../db/repositories";
import { metaMcpServerPool } from "./metamcp";
import { convertDbServerToParams } from "./metamcp/utils";

/**
 * Startup function to initialize idle servers for all namespaces and all MCP servers
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

    // Initialize idle sessions for the underlying MCP server pool with ALL servers
    if (Object.keys(allServerParams).length > 0) {
      const { mcpServerPool } = await import("./metamcp");
      await mcpServerPool.ensureIdleSessions(allServerParams);
      console.log(
        "✅ Successfully initialized idle MCP server pool sessions for ALL servers",
      );
    }

    // Ensure idle servers for all namespaces (MetaMCP server pool)
    if (namespaceUuids.length > 0) {
      await metaMcpServerPool.ensureIdleServers(namespaceUuids, true);
      console.log(
        "✅ Successfully initialized idle servers for all namespaces",
      );
    }

    console.log(
      "✅ Successfully initialized idle servers for all namespaces and all MCP servers",
    );
  } catch (error) {
    console.error("❌ Error initializing idle servers:", error);
    // Don't exit the process, just log the error
    // The server should still start even if idle server initialization fails
  }
}
