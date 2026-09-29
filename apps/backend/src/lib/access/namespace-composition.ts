import { eq } from "drizzle-orm";

import { db } from "../../db/index";
import { endpointsRepository } from "../../db/repositories/endpoints.repo";
import { namespacesRepository } from "../../db/repositories/namespaces.repo";
import { resourceSharesRepository } from "../../db/repositories/resource-shares.repo";
import { mcpServersTable, namespaceServerMappingsTable } from "../../db/schema";
import { accessService } from "./access.service";
import { endpointAccessCache } from "./endpoint-access-cache";
import { canRedistributeServer } from "./sharing-rules";

/**
 * Servers a namespace may still expose, checked when MCP traffic runs.
 *
 * Access to a server is verified when it is added to a namespace, but shares
 * change afterwards. Without this check, revoking a server share (or a group
 * membership, or downgrading "manage" to "use") left the server reachable
 * forever through the namespaces built on it. A server stays in a namespace
 * while the namespace owner can use it; when the namespace is shared or
 * published without authentication, the owner must also be allowed to
 * redistribute it (see sharing-rules.ts). Organisation namespaces serve the
 * whole organisation: they expose organisation servers, and personal servers
 * only while their owner shares them with everyone.
 */

const TTL_MS = 5_000;
const MAX_ENTRIES = 2_000;

/** null: every mapped server is allowed. */
type Allowed = ReadonlySet<string> | null;

const cache = new Map<string, { allowed: Allowed; expiresAt: number }>();
endpointAccessCache.onClear(() => cache.clear());

async function computeAllowedServers(namespaceUuid: string): Promise<Allowed> {
  const namespace = await namespacesRepository.findByUuid(namespaceUuid);
  if (!namespace) return new Set();

  const servers = await db
    .select({
      uuid: mcpServersTable.uuid,
      user_id: mcpServersTable.user_id,
    })
    .from(namespaceServerMappingsTable)
    .innerJoin(
      mcpServersTable,
      eq(mcpServersTable.uuid, namespaceServerMappingsTable.mcp_server_uuid),
    )
    .where(eq(namespaceServerMappingsTable.namespace_uuid, namespaceUuid));

  if (namespace.user_id === null) {
    const personal = servers.filter((server) => server.user_id !== null);
    if (personal.length === 0) return null;
    const [grants, everyone] = await Promise.all([
      resourceSharesRepository.findGrantsForResources(
        "mcp_server",
        personal.map((server) => server.uuid),
      ),
      accessService.getEveryoneGroup(),
    ]);
    const allowed = new Set(
      servers
        .filter(
          (server) =>
            server.user_id === null ||
            grants.some(
              (grant) =>
                grant.resourceUuid === server.uuid &&
                grant.groupUuid !== null &&
                grant.groupUuid === everyone?.uuid,
            ),
        )
        .map((server) => server.uuid),
    );
    return allowed;
  }
  const ownerId = namespace.user_id;

  // The owner's own servers always stay.
  const allowed = new Set(
    servers.filter((server) => server.user_id === ownerId).map((s) => s.uuid),
  );
  const others = servers.filter((server) => server.user_id !== ownerId);
  if (others.length === 0) return allowed;

  // A disabled owner can no longer use what was shared with them.
  const principal = await accessService.getPrincipal(ownerId);
  if (!principal) return allowed;

  const [access, namespaceGrants, endpoints, serverGrants, everyone] =
    await Promise.all([
      accessService.resolveAccess(principal, "mcp_server", others),
      resourceSharesRepository.findGrantsForResources("namespace", [
        namespaceUuid,
      ]),
      endpointsRepository.findByNamespaceUuid(namespaceUuid),
      resourceSharesRepository.findGrantsForResources(
        "mcp_server",
        others.map((server) => server.uuid),
      ),
      accessService.getEveryoneGroup(),
    ]);
  const redistributed =
    namespaceGrants.length > 0 ||
    endpoints.some(
      (endpoint) => !endpoint.enable_api_key_auth && !endpoint.enable_oauth,
    );

  for (const server of others) {
    const serverAccess = access.get(server.uuid) ?? null;
    if (!serverAccess) continue;
    if (
      redistributed &&
      !canRedistributeServer(principal, {
        uuid: server.uuid,
        name: "",
        access: serverAccess,
        sharedWithEveryone: serverGrants.some(
          (grant) =>
            grant.resourceUuid === server.uuid &&
            grant.groupUuid !== null &&
            grant.groupUuid === everyone?.uuid,
        ),
      })
    ) {
      continue;
    }
    allowed.add(server.uuid);
  }
  return allowed;
}

/** Servers the namespace may expose right now (null: all of them). */
export async function allowedNamespaceServers(
  namespaceUuid: string,
): Promise<Allowed> {
  const cached = cache.get(namespaceUuid);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;
  const allowed = await computeAllowedServers(namespaceUuid);
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(namespaceUuid, { allowed, expiresAt: Date.now() + TTL_MS });
  return allowed;
}

export async function isServerAllowedInNamespace(
  namespaceUuid: string,
  serverUuid: string,
): Promise<boolean> {
  const allowed = await allowedNamespaceServers(namespaceUuid);
  return allowed === null || allowed.has(serverUuid);
}
