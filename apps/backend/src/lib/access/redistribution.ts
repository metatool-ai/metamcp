import type { AccessPrincipal } from "@repo/zod-types";

import { ApiKeysRepository } from "../../db/repositories/api-keys.repo";
import { endpointsRepository } from "../../db/repositories/endpoints.repo";
import { namespacesRepository } from "../../db/repositories/namespaces.repo";
import { oauthRepository } from "../../db/repositories/oauth.repo";
import { resourceSharesRepository } from "../../db/repositories/resource-shares.repo";
import { accessService } from "./access.service";
import {
  describeRedistributionError,
  findNonRedistributableServers,
} from "./sharing-rules";

const apiKeysRepository = new ApiKeysRepository();

/**
 * A namespace can only be shared when every server it contains may be
 * redistributed by the caller (see sharing-rules.ts).
 */
export async function checkNamespaceRedistribution(
  principal: AccessPrincipal,
  namespaceUuid: string,
): Promise<string | null> {
  if (principal.isAdmin) return null;
  const namespace =
    await namespacesRepository.findByUuidWithServers(namespaceUuid);
  const servers = namespace?.servers ?? [];
  if (servers.length === 0) return null;

  const [access, grants, everyone] = await Promise.all([
    accessService.resolveAccess(principal, "mcp_server", servers),
    resourceSharesRepository.findGrantsForResources(
      "mcp_server",
      servers.map((server) => server.uuid),
    ),
    accessService.getEveryoneGroup(),
  ]);
  const blocked = findNonRedistributableServers(
    principal,
    servers.map((server) => ({
      uuid: server.uuid,
      name: server.name,
      access: access.get(server.uuid) ?? null,
      sharedWithEveryone: grants.some(
        (grant) =>
          grant.resourceUuid === server.uuid &&
          grant.groupUuid !== null &&
          grant.groupUuid === everyone?.uuid,
      ),
    })),
  );
  return blocked.length > 0 ? describeRedistributionError(blocked) : null;
}

const API_KEY_PATTERN = /sk_mt_[A-Za-z0-9]{32,}/g;
const OAUTH_TOKEN_PATTERN = /mcp_token_[A-Za-z0-9_-]{16,}/g;

type ServerCredentials = {
  name: string;
  bearerToken?: string | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  env?: Record<string, string> | null;
  args?: string[] | null;
};

/**
 * MetaMCP credentials stored in a server's configuration: a server pointing
 * back at MetaMCP with such a credential (e.g. the "<endpoint>-endpoint"
 * server generated with an endpoint) gives whoever uses it the access of the
 * credential. `fullAccess`: a personal key or OAuth token (everything its
 * owner can reach); `namespaceUuids`: what endpoint-scoped keys reach.
 */
export async function findEmbeddedCredentials(
  server: ServerCredentials,
): Promise<{ fullAccess: boolean; namespaceUuids: string[] }> {
  const text = [
    server.bearerToken ?? "",
    server.url ?? "",
    ...Object.values(server.headers ?? {}),
    ...Object.values(server.env ?? {}),
    ...(server.args ?? []),
  ].join("\n");

  let fullAccess = false;
  const endpointUuids = new Set<string>();
  for (const key of new Set(text.match(API_KEY_PATTERN) ?? [])) {
    const validation = await apiKeysRepository.validateApiKey(key);
    if (!validation.valid) continue;
    if (validation.scope === "endpoints") {
      validation.endpoint_uuids?.forEach((uuid) => endpointUuids.add(uuid));
    } else {
      fullAccess = true;
    }
  }
  for (const token of new Set(text.match(OAUTH_TOKEN_PATTERN) ?? [])) {
    if (await oauthRepository.getActiveAccessToken(token)) {
      fullAccess = true;
    }
  }

  const endpoints = await endpointsRepository.findByUuidsWithNamespaceOwner([
    ...endpointUuids,
  ]);
  return {
    fullAccess,
    namespaceUuids: [...new Set(endpoints.map((e) => e.namespace.uuid))],
  };
}

/**
 * Whether `principal` may hand the use of `server` to others (share it, or
 * put it in a shared namespace): when it embeds MetaMCP credentials, the
 * namespaces those reach must be redistributable by the caller, and a full
 * personal credential never is. Returns an error message, or null.
 */
export async function checkEmbeddedCredentialRedistribution(
  principal: AccessPrincipal,
  server: ServerCredentials,
): Promise<string | null> {
  if (principal.isAdmin) return null;
  const credentials = await findEmbeddedCredentials(server);
  if (credentials.fullAccess) {
    return `MCP server "${server.name}" contains a personal MetaMCP API key or token: sharing it would share that account's whole access. Use an API key limited to specific endpoints.`;
  }
  for (const namespaceUuid of credentials.namespaceUuids) {
    const blocked = await checkNamespaceRedistribution(
      principal,
      namespaceUuid,
    );
    if (blocked) {
      return `MCP server "${server.name}" gives access to a MetaMCP endpoint whose namespace you cannot share: ${blocked}`;
    }
  }
  return null;
}
