import type { AccessPrincipal, ResourceAccess } from "@repo/zod-types";

/**
 * Composition rules that stop a user from re-sharing an MCP server beyond the
 * audience its owner chose.
 *
 * Sharing a namespace gives its audience the tools of every server inside it.
 * So a namespace may only be shared (or, once shared, receive new servers)
 * when, for every server it contains, the acting user either manages that
 * server or the server is already available to the whole organisation.
 * A server shared with someone "for use" can therefore be used in their own
 * private namespaces, but never redistributed through them. Administrators
 * follow the same rules (they manage the organisation's servers, not the
 * personal servers of others).
 */

export type ServerForComposition = {
  uuid: string;
  name: string;
  /** Access of the acting user on the server. */
  access: ResourceAccess | null;
  /** Whether the server is shared with the "Everyone" group. */
  sharedWithEveryone: boolean;
};

export function canRedistributeServer(
  principal: AccessPrincipal,
  server: ServerForComposition,
): boolean {
  if (server.sharedWithEveryone) return true;
  return server.access?.level === "manage";
}

/** Servers that would leak if the namespace were shared by `principal`. */
export function findNonRedistributableServers(
  principal: AccessPrincipal,
  servers: readonly ServerForComposition[],
): ServerForComposition[] {
  return servers.filter((server) => !canRedistributeServer(principal, server));
}

export function describeRedistributionError(
  servers: readonly ServerForComposition[],
): string {
  const names = servers.map((server) => `"${server.name}"`).join(", ");
  return servers.length === 1
    ? `MCP server ${names} was shared with you for your own use only, so a namespace containing it cannot be shared. Ask its owner for "manage" access, or remove it from the namespace.`
    : `MCP servers ${names} were shared with you for your own use only, so a namespace containing them cannot be shared. Ask their owners for "manage" access, or remove them from the namespace.`;
}
