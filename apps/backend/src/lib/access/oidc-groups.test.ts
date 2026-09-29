import { describe, expect, it } from "vitest";

import {
  diffOidcMemberships,
  extractGroupsFromClaims,
  hasGroupsOverage,
  matchesGroupPattern,
  resolveMappedGroups,
} from "./oidc-groups";

describe("extractGroupsFromClaims", () => {
  it("reads a plain array claim", () => {
    expect(
      extractGroupsFromClaims({ groups: ["devs", "ops"] }, "groups"),
    ).toEqual(["devs", "ops"]);
  });

  it("returns null (unknown) when the claim is missing", () => {
    expect(extractGroupsFromClaims({ sub: "x" }, "groups")).toBeNull();
    expect(extractGroupsFromClaims(null, "groups")).toBeNull();
    expect(
      extractGroupsFromClaims({ realm_access: {} }, "realm_access.roles"),
    ).toBeNull();
  });

  it("returns an empty list when the claim is present but empty", () => {
    expect(extractGroupsFromClaims({ groups: [] }, "groups")).toEqual([]);
  });

  it("treats a Microsoft Entra groups overage as unknown", () => {
    expect(
      extractGroupsFromClaims(
        {
          _claim_names: { groups: "src1" },
          _claim_sources: { src1: { endpoint: "https://graph" } },
        },
        "groups",
      ),
    ).toBeNull();
    expect(
      hasGroupsOverage({ _claim_names: { groups: "src1" } }, "groups"),
    ).toBe(true);
  });

  it("supports dot paths such as Keycloak realm roles", () => {
    expect(
      extractGroupsFromClaims(
        { realm_access: { roles: ["offline_access", "metamcp-admin"] } },
        "realm_access.roles",
      ),
    ).toEqual(["offline_access", "metamcp-admin"]);
  });

  it("never reads inherited properties through a dot path", () => {
    expect(
      extractGroupsFromClaims({ groups: ["a"] }, "__proto__.constructor"),
    ).toBeNull();
    expect(extractGroupsFromClaims({}, "constructor.name")).toBeNull();
    expect(extractGroupsFromClaims({}, "toString")).toBeNull();
  });

  it("prefers a literal claim name containing dots (Auth0 namespaced claims)", () => {
    expect(
      extractGroupsFromClaims(
        { "https://corp.example.com/groups": ["platform"] },
        "https://corp.example.com/groups",
      ),
    ).toEqual(["platform"]);
  });

  it("splits comma separated strings and keeps single strings intact", () => {
    expect(extractGroupsFromClaims({ groups: "a, b ,c" }, "groups")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      extractGroupsFromClaims({ groups: "Domain Users" }, "groups"),
    ).toEqual(["Domain Users"]);
  });

  it("accepts arrays of objects and de-duplicates case-insensitively", () => {
    expect(
      extractGroupsFromClaims(
        {
          groups: [
            { name: "Devs" },
            { value: "devs" },
            { id: "0b8c0a4e-guid" },
            {},
            "  ",
          ],
        },
        "groups",
      ),
    ).toEqual(["Devs", "0b8c0a4e-guid"]);
  });
});

describe("matchesGroupPattern", () => {
  it("matches exactly, ignoring case and surrounding spaces", () => {
    expect(matchesGroupPattern("MetaMCP-Admins", " metamcp-admins ")).toBe(
      true,
    );
    expect(matchesGroupPattern("metamcp-admins-old", "metamcp-admins")).toBe(
      false,
    );
  });

  it("supports * wildcards, including Keycloak group paths", () => {
    expect(matchesGroupPattern("/engineering/backend", "/engineering/*")).toBe(
      true,
    );
    expect(matchesGroupPattern("/sales/emea", "/engineering/*")).toBe(false);
    expect(matchesGroupPattern("team-a-admins", "*-admins")).toBe(true);
  });

  it("treats regex metacharacters literally", () => {
    expect(matchesGroupPattern("a.b", "a.b")).toBe(true);
    expect(matchesGroupPattern("axb", "a.b")).toBe(false);
    expect(matchesGroupPattern("(ops)", "(ops)")).toBe(true);
  });

  it("ignores a leading slash on either side (Keycloak full paths)", () => {
    expect(matchesGroupPattern("/metamcp-admins", "metamcp-admins")).toBe(true);
    expect(matchesGroupPattern("team/dev", "/team/dev")).toBe(true);
    expect(matchesGroupPattern("/team/dev", "/team/*")).toBe(true);
  });

  it("never matches an empty pattern", () => {
    expect(matchesGroupPattern("anything", "  ")).toBe(false);
  });

  it("handles several and consecutive wildcards", () => {
    expect(matchesGroupPattern("org-eng-team-admins", "org-*-*-admins")).toBe(
      true,
    );
    expect(matchesGroupPattern("abc", "a**c")).toBe(true);
    expect(matchesGroupPattern("abc", "*")).toBe(true);
    expect(matchesGroupPattern("", "*")).toBe(true);
    expect(matchesGroupPattern("aaab", "a*a*b")).toBe(true);
    expect(matchesGroupPattern("abab", "*ab")).toBe(true);
    expect(matchesGroupPattern("abac", "*ab")).toBe(false);
  });

  it("stays fast on pathological patterns", () => {
    const value = "a".repeat(5000);
    const started = performance.now();
    expect(matchesGroupPattern(value, `${"*a".repeat(50)}b`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("resolveMappedGroups", () => {
  const groups = [
    { uuid: "admins", oidcGroups: ["metamcp-admins"] },
    { uuid: "eng", oidcGroups: ["/engineering/*", "devs"] },
    { uuid: "unmapped", oidcGroups: [] },
  ];

  it("returns every group matched by at least one IdP group", () => {
    expect(
      resolveMappedGroups(["DEVS", "/engineering/web", "sales"], groups),
    ).toEqual([{ groupUuid: "eng", matchedBy: ["DEVS", "/engineering/web"] }]);
  });

  it("returns nothing when no mapping matches", () => {
    expect(resolveMappedGroups(["sales"], groups)).toEqual([]);
  });
});

describe("diffOidcMemberships", () => {
  it("adds matched groups and removes stale OIDC memberships", () => {
    expect(
      diffOidcMemberships({
        matchedGroupUuids: ["a", "b"],
        currentMemberships: [
          { groupUuid: "b", source: "oidc" },
          { groupUuid: "c", source: "oidc" },
        ],
      }),
    ).toEqual({ toAdd: ["a"], toRemove: ["c"] });
  });

  it("never removes or duplicates manual memberships", () => {
    expect(
      diffOidcMemberships({
        matchedGroupUuids: ["a"],
        currentMemberships: [
          { groupUuid: "a", source: "manual" },
          { groupUuid: "m", source: "manual" },
        ],
      }),
    ).toEqual({ toAdd: [], toRemove: [] });
  });

  it("skips excluded groups such as Everyone", () => {
    expect(
      diffOidcMemberships({
        matchedGroupUuids: ["everyone", "a"],
        currentMemberships: [],
        excludedGroupUuids: ["everyone"],
      }),
    ).toEqual({ toAdd: ["a"], toRemove: [] });
  });
});
