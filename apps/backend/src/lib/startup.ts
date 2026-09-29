import { ServerParameters } from "@repo/zod-types";

import {
  endpointsRepository,
  mcpServersRepository,
  namespacesRepository,
} from "../db/repositories";
import { groupsRepository } from "../db/repositories/groups.repo";
import { initializeEnvironmentConfiguration } from "./bootstrap.service";
import { mcpServerPool, metaMcpServerPool } from "./metamcp";
import { getMcpServers } from "./metamcp/fetch-metamcp";
import { serverErrorTracker } from "./metamcp/server-error-tracker";

/**
 * Startup initialization that must happen before the HTTP server begins listening.
 *
 * IMPORTANT: This function does not prevent the app from starting unless BOOTSTRAP_FAIL_HARD=true.
 */
export async function initializeOnStartup(): Promise<void> {
  const parseBool = (value: string | undefined, defaultValue: boolean) => {
    if (value === undefined) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return defaultValue;
  };

  const enableEnvBootstrap = parseBool(process.env.BOOTSTRAP_ENABLE, true);
  const failHard = parseBool(process.env.BOOTSTRAP_FAIL_HARD, false);

  // RBAC system groups ("Administrators", "Everyone") are created by the
  // migration; make sure they exist even if a row was removed manually.
  try {
    await groupsRepository.ensureSystemGroups();
  } catch (err) {
    console.error("❌ Failed to ensure RBAC system groups:", err);
  }

  if (enableEnvBootstrap) {
    try {
      await initializeEnvironmentConfiguration();
    } catch (err) {
      console.error(
        "❌ Error initializing environment-based configuration (ignored):",
        err,
      );
      if (failHard) {
        throw err;
      }
    }
  } else {
    console.log("Environment bootstrap disabled via BOOTSTRAP_ENABLE=false");
  }
}

/**
 * Startup (and error reset) initialization of the connection pools. Always
 * gives servers in ERROR a fresh chance. Only a warm pool (MCP_WARM_POOL)
 * then starts a spare connection per server, and only for the servers an
 * endpoint exposes: the others are reached from the inspector alone.
 */
export async function initializeIdleServers() {
  try {
    // Reset all ERROR statuses so servers get a fresh chance on restart
    const resetCount = await mcpServersRepository.resetAllErrorStatuses();
    if (resetCount > 0) {
      console.log(
        `Reset ${resetCount} server(s) from ERROR to NONE status on startup`,
      );
    }
    // Also clear in-memory crash attempt counters
    serverErrorTracker.resetAllAttempts();

    // Fetch all namespaces from the database
    const namespaces = await namespacesRepository.findAll();
    const namespaceUuids = namespaces.map((namespace) => namespace.uuid);

    if (namespaceUuids.length === 0) {
      console.log("No namespaces found in database");
    } else {
      console.log(`Found ${namespaceUuids.length} namespaces`);
    }

    if (!mcpServerPool.isWarm) {
      console.log(
        "MCP connections open on first use (set MCP_WARM_POOL=true to keep one started per server)",
      );
    } else {
      // Servers of the namespaces an endpoint exposes
      const endpoints = await endpointsRepository.findAll();
      const exposedNamespaceUuids = [
        ...new Set(endpoints.map((endpoint) => endpoint.namespace_uuid)),
      ];
      const exposedServerParams: Record<string, ServerParameters> = {};
      for (const namespaceUuid of exposedNamespaceUuids) {
        Object.assign(exposedServerParams, await getMcpServers(namespaceUuid));
      }

      const count = Object.keys(exposedServerParams).length;
      if (count > 0) {
        await mcpServerPool.ensureIdleSessions(exposedServerParams);
      }
      console.log(
        `✅ Warm MCP pool: started idle connections for ${count} server(s) exposed by ${exposedNamespaceUuids.length} namespace(s)`,
      );
    }

    // Ensure idle servers for all namespaces (MetaMCP server pool). These are
    // in-process objects: no connection to MCP servers until used.
    if (namespaceUuids.length > 0) {
      await metaMcpServerPool.ensureIdleServers(namespaceUuids, true);
      console.log(
        "✅ Successfully initialized idle servers for all namespaces",
      );
    }
  } catch (error) {
    console.log("❌ Error initializing idle servers:", error);
    // Don't exit the process, just log the error
    // The server should still start even if idle server initialization fails
  }
}
