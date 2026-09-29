/**
 * Pure helpers turning an OIDC groups claim into MetaMCP group memberships.
 *
 * Supported claim shapes (as emitted by common IdPs):
 *   - Keycloak / Authentik / Okta / Entra ID: `"groups": ["a", "b"]`
 *   - Keycloak roles:            `"realm_access": { "roles": [...] }`
 *     -> configure the claim as `realm_access.roles`
 *   - Auth0 namespaced claims:   `"https://example.com/groups": [...]`
 *     (the literal claim name is tried before dot-path traversal)
 *   - comma separated strings and arrays of objects (`name`/`value`/`id`).
 */

const MAX_GROUPS = 1000;

function valueToGroupName(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "value", "displayName", "id"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }
  return null;
}

function readClaim(
  claims: Record<string, unknown>,
  claimName: string,
): unknown {
  if (Object.hasOwn(claims, claimName)) {
    return claims[claimName];
  }
  // Dot-path traversal, e.g. `realm_access.roles` or `resource_access.app.roles`.
  // Own properties only: never walk into the prototype chain (`__proto__`).
  let current: unknown = claims;
  for (const segment of claimName.split(".")) {
    if (
      !current ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    // Read-only walk through own properties (checked above): no pollution.
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Whether the IdP signalled that the groups claim was omitted because the user
 * has too many groups (Microsoft Entra ID "groups overage").
 */
export function hasGroupsOverage(
  claims: Record<string, unknown> | null | undefined,
  claimName: string,
): boolean {
  const claimNames = claims?._claim_names;
  return Boolean(
    claimNames &&
    typeof claimNames === "object" &&
    claimName in (claimNames as Record<string, unknown>),
  );
}

/**
 * Extracts a de-duplicated list of group names from a claims object.
 *
 * Returns `null` when the claim is absent (or an Entra overage marker is
 * present): an unknown group list must not be mistaken for "no groups", which
 * would strip every synced membership.
 */
export function extractGroupsFromClaims(
  claims: Record<string, unknown> | null | undefined,
  claimName: string,
): string[] | null {
  if (!claims || !claimName) {
    return null;
  }
  if (hasGroupsOverage(claims, claimName.trim())) {
    return null;
  }
  const raw = readClaim(claims, claimName.trim());

  let values: unknown[];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === "string") {
    values = raw.includes(",") ? raw.split(",") : [raw];
  } else if (raw === undefined || raw === null) {
    return null;
  } else {
    values = [raw];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const name = valueToGroupName(value);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      result.push(name);
      if (result.length >= MAX_GROUPS) break;
    }
  }
  return result;
}

/** Lowercases and drops one leading "/" (Keycloak full group paths). */
function normalizeGroupValue(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

/**
 * Case-insensitive match of an IdP group value against a mapping pattern.
 * `*` matches any sequence of characters; everything else is literal. A
 * leading "/" is ignored on both sides so Keycloak full paths ("/team/dev")
 * and plain names ("team/dev") are interchangeable.
 */
export function matchesGroupPattern(value: string, pattern: string): boolean {
  const normalizedValue = normalizeGroupValue(value);
  const normalizedPattern = normalizeGroupValue(pattern);
  if (!normalizedPattern) {
    return false;
  }
  if (!normalizedPattern.includes("*")) {
    return normalizedValue === normalizedPattern;
  }
  return globMatch(normalizedValue, normalizedPattern);
}

/**
 * `*` wildcard matching without regular expressions: a greedy two-pointer
 * scan with a single backtrack point, O(value × pattern) in the worst case,
 * so admin-defined patterns cannot trigger catastrophic backtracking.
 */
function globMatch(value: string, pattern: string): boolean {
  let v = 0;
  let p = 0;
  let star = -1;
  let resume = 0;
  while (v < value.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      resume = v;
    } else if (p < pattern.length && pattern[p] === value[v]) {
      p++;
      v++;
    } else if (star !== -1) {
      p = star + 1;
      v = ++resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

export type MappableGroup = {
  uuid: string;
  oidcGroups: readonly string[];
};

export type GroupMatch = {
  groupUuid: string;
  matchedBy: string[];
};

/** Returns the MetaMCP groups whose mappings match at least one IdP group. */
export function resolveMappedGroups(
  externalGroups: readonly string[],
  groups: readonly MappableGroup[],
): GroupMatch[] {
  const matches: GroupMatch[] = [];
  for (const group of groups) {
    if (group.oidcGroups.length === 0) continue;
    const matchedBy = externalGroups.filter((external) =>
      group.oidcGroups.some((pattern) =>
        matchesGroupPattern(external, pattern),
      ),
    );
    if (matchedBy.length > 0) {
      matches.push({ groupUuid: group.uuid, matchedBy });
    }
  }
  return matches;
}

/**
 * Computes the membership changes needed to align OIDC-sourced memberships
 * with the groups matched at login. Manual memberships are never touched.
 */
export function diffOidcMemberships(input: {
  matchedGroupUuids: readonly string[];
  currentMemberships: readonly {
    groupUuid: string;
    source: "manual" | "oidc";
  }[];
  /** Groups that can never receive stored memberships (e.g. "Everyone"). */
  excludedGroupUuids?: readonly string[];
}): { toAdd: string[]; toRemove: string[] } {
  const excluded = new Set(input.excludedGroupUuids ?? []);
  const matched = new Set(
    input.matchedGroupUuids.filter((uuid) => !excluded.has(uuid)),
  );
  const current = new Map(
    input.currentMemberships.map((membership) => [
      membership.groupUuid,
      membership.source,
    ]),
  );

  const toAdd = [...matched].filter((uuid) => !current.has(uuid));
  const toRemove = input.currentMemberships
    .filter(
      (membership) =>
        membership.source === "oidc" && !matched.has(membership.groupUuid),
    )
    .map((membership) => membership.groupUuid);

  return { toAdd, toRemove };
}
