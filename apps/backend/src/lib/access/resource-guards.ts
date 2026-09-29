import type {
  AccessPrincipal,
  ResourceAccess,
  ShareLevel,
} from "@repo/zod-types";
import { isShareLevelAtLeast } from "@repo/zod-types";

export type OwnerDecision =
  | { ok: true; ownerId: string | null }
  | { ok: false; message: string };

/**
 * Owner of a resource being created. `requested` follows the historical API:
 * undefined = the caller, null = the organisation, string = a user id.
 * Only administrators may create organisation resources or create on behalf
 * of someone else.
 */
export function decideOwnerForCreate(
  principal: AccessPrincipal,
  requested: string | null | undefined,
): OwnerDecision {
  if (requested === undefined || requested === principal.userId) {
    return { ok: true, ownerId: principal.userId };
  }
  if (!principal.isAdmin) {
    return {
      ok: false,
      message:
        requested === null
          ? "Only administrators can create organisation-owned resources. Create it as your own and share it instead."
          : "You can only create resources for yourself.",
    };
  }
  return { ok: true, ownerId: requested };
}

/**
 * Owner after an update: unchanged unless an administrator explicitly moves
 * the resource to another user or to the organisation.
 */
export function decideOwnerForUpdate(
  principal: AccessPrincipal,
  current: string | null,
  requested: string | null | undefined,
): OwnerDecision {
  if (requested === undefined || requested === current) {
    return { ok: true, ownerId: current };
  }
  if (!principal.isAdmin) {
    return {
      ok: false,
      message: "Only administrators can change the owner of a resource.",
    };
  }
  return { ok: true, ownerId: requested };
}

export function hasLevel(
  access: ResourceAccess | null | undefined,
  required: ShareLevel,
): access is ResourceAccess {
  return Boolean(access) && isShareLevelAtLeast(access?.level, required);
}

/** Same message whether the resource is missing or hidden, to avoid leaking existence. */
export function notFoundMessage(kind: string): string {
  return `${kind} not found`;
}

export function forbiddenMessage(action: string, required: ShareLevel): string {
  const verb =
    required === "manage" ? "manage" : required === "edit" ? "edit" : "use";
  return `Access denied: you need "${verb}" permission to ${action}.`;
}

function redactRecord(record: Record<string, string> | null | undefined) {
  return Object.fromEntries(Object.keys(record ?? {}).map((key) => [key, ""]));
}

/**
 * Only the origin: besides user info and the query string, many hosted MCP
 * services put the secret in the path (…/s/<token>/mcp).
 */
function redactUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Strips everything that may carry credentials from an MCP server shared at
 * "use" level: env values, bearer token, header values, STDIO arguments and
 * everything in the URL but its origin. Keys are kept so users see what is
 * set.
 */
export function redactServerSecrets<
  T extends {
    args: string[];
    env: Record<string, string>;
    url: string | null;
    bearerToken: string | null;
    headers: Record<string, string>;
  },
>(server: T): T & { secretsRedacted: true } {
  return {
    ...server,
    args: [],
    env: redactRecord(server.env),
    url: redactUrl(server.url),
    bearerToken: null,
    headers: redactRecord(server.headers),
    secretsRedacted: true,
  };
}
