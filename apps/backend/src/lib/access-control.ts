import { TRPCError } from "@trpc/server";

import { isAdminUser, isMultiTenantMode } from "./admin";
import { findUserEmailById } from "./user-lookup";

/**
 * Ownership / administrator rules shared by the tRPC implementations and the
 * MetaMCP admin MCP tools.
 *
 * Resources (MCP servers, namespaces, endpoints, API keys) carry a `user_id`:
 *   - a user id  → private to that user
 *   - null       → public (visible to every user)
 *
 * Reading: the owner, or anyone for public resources.
 * Writing: the owner; public resources only by administrators.
 *
 * Administrators are resolved from METAMCP_ADMIN_EMAILS (see ./admin.ts).
 * When it is unset every signed-in user is an administrator, preserving the
 * historical single-tenant behaviour.
 */

export class AccessDeniedError extends TRPCError {
  constructor(message: string) {
    super({ code: "FORBIDDEN", message });
  }
}

/**
 * Whether the user with this id is an administrator. Only touches the
 * database in multi-tenant mode.
 */
export async function isAdminUserId(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!isMultiTenantMode()) return true;
  if (!userId) return false;
  const email = await findUserEmailById(userId);
  return isAdminUser({ email });
}

export async function assertAdminUserId(
  userId: string | null | undefined,
  message = "Administrator privileges are required for this action",
): Promise<void> {
  if (!(await isAdminUserId(userId))) {
    throw new AccessDeniedError(message);
  }
}

/** Owner, or anyone for public (user_id = null) resources. */
export function canReadResource(
  ownerId: string | null | undefined,
  userId: string,
): boolean {
  return ownerId === null || ownerId === undefined || ownerId === userId;
}

/** Owner; public resources require an administrator. */
export async function canModifyResource(
  ownerId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (ownerId === null || ownerId === undefined) {
    return isAdminUserId(userId);
  }
  return ownerId === userId;
}

/**
 * Whether the caller may see secrets (env, bearer token, headers, OAuth
 * tokens) of a resource: the owner of a private resource, or an
 * administrator for a public one. Same rule as modification.
 */
export const canViewResourceSecrets = canModifyResource;

/**
 * Resolve the `user_id` to store for a create/update request.
 *
 * - undefined         → `fallback` (the caller on create, the existing owner on update)
 * - the caller's id   → the caller
 * - null              → public; administrators only
 * - any other user id → rejected (no assigning resources to other users)
 */
export async function resolveRequestedOwner(
  requested: string | null | undefined,
  userId: string,
  fallback: string | null,
): Promise<string | null> {
  if (requested === undefined) return fallback;
  if (requested === userId) return userId;
  if (requested === null) {
    if (await isAdminUserId(userId)) return null;
    throw new AccessDeniedError(
      "Only administrators can create or modify public resources",
    );
  }
  throw new AccessDeniedError("You cannot assign a resource to another user");
}

/**
 * STDIO MCP servers execute arbitrary commands inside the backend container.
 * In multi-tenant mode only administrators may create or modify them.
 */
export async function assertCanManageStdioServer(
  userId: string,
): Promise<void> {
  if (!isMultiTenantMode()) return;
  await assertAdminUserId(
    userId,
    "Only administrators can create or modify STDIO MCP servers",
  );
}

const REDACTED = "********";

function redactRecord(
  record: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!record) return {};
  return Object.fromEntries(Object.keys(record).map((k) => [k, REDACTED]));
}

/**
 * Strip secrets from a serialized MCP server for callers who may not see
 * them. Keys of env/headers are kept (values masked) so the UI can still show
 * which variables are configured.
 */
export function redactServerSecrets<
  T extends {
    env?: Record<string, string> | null;
    bearerToken?: string | null;
    headers?: Record<string, string> | null;
  },
>(server: T): T {
  return {
    ...server,
    env: redactRecord(server.env),
    bearerToken: null,
    headers: redactRecord(server.headers),
  };
}

/**
 * Build a per-request predicate deciding whether a server's secrets may be
 * returned. Resolves the admin flag at most once.
 */
export async function createSecretsVisibility(
  userId: string,
): Promise<(ownerId: string | null | undefined) => boolean> {
  const admin = await isAdminUserId(userId);
  return (ownerId) =>
    ownerId === null || ownerId === undefined ? admin : ownerId === userId;
}
