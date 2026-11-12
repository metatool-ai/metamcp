/**
 * Administrator resolution.
 *
 * MetaMCP has no role column. Administrators are configured with the
 * METAMCP_ADMIN_EMAILS environment variable (comma-separated, case-insensitive).
 *
 * - When METAMCP_ADMIN_EMAILS is set ("multi-tenant mode"), only those users may
 *   change global configuration, modify public (user_id = null) resources, or
 *   create/modify STDIO MCP servers (which execute commands in the backend).
 * - When it is unset, every signed-in user is treated as an administrator,
 *   which preserves the historical single-tenant behaviour.
 */
export function getAdminEmails(): string[] | null {
  const raw = process.env.METAMCP_ADMIN_EMAILS;
  if (!raw || !raw.trim()) return null;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isMultiTenantMode(): boolean {
  return getAdminEmails() !== null;
}

export function isAdminUser(
  user: { email?: string | null } | null | undefined,
): boolean {
  const admins = getAdminEmails();
  if (admins === null) return true;
  const email = user?.email?.trim().toLowerCase();
  return !!email && admins.includes(email);
}
