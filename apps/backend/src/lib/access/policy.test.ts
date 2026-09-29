import type { AccessPrincipal, RolePermissions } from "@repo/zod-types";
import { describe, expect, it } from "vitest";

import {
  ALL_CAPABILITIES,
  buildPrincipal,
  canInspect,
  hasCapability,
  resolveCapabilities,
  resolveEffectiveRole,
  resolveResourceAccess,
  type ShareGrant,
} from "./policy";

const EVERYONE = "00000000-0000-0000-0000-00000000e0e0";

function principal(overrides: Partial<AccessPrincipal> = {}): AccessPrincipal {
  return {
    userId: "user-1",
    baseRole: "viewer",
    role: "viewer",
    isAdmin: false,
    capabilities: [],
    groupUuids: [],
    ...overrides,
  };
}

describe("resolveEffectiveRole", () => {
  it("keeps the base role when no group grants a role", () => {
    expect(resolveEffectiveRole("viewer", [])).toBe("viewer");
    expect(resolveEffectiveRole("editor", [null, undefined])).toBe("editor");
  });

  it("elevates to the highest group-granted role", () => {
    expect(resolveEffectiveRole("viewer", ["editor"])).toBe("editor");
    expect(resolveEffectiveRole("viewer", ["editor", "admin", null])).toBe(
      "admin",
    );
  });

  it("never lowers the base role", () => {
    expect(resolveEffectiveRole("admin", ["viewer"])).toBe("admin");
    expect(resolveEffectiveRole("editor", ["viewer"])).toBe("editor");
  });
});

describe("resolveCapabilities", () => {
  it("gives admins every capability even with an empty matrix", () => {
    const empty: RolePermissions = { editor: [], viewer: [] };
    expect(resolveCapabilities("admin", empty)).toEqual([...ALL_CAPABILITIES]);
  });

  it("uses the configured matrix for editors and viewers", () => {
    const matrix: RolePermissions = {
      editor: ["namespaces.create", "mcp_servers.create_stdio"],
      viewer: ["api_keys.create"],
    };
    expect(resolveCapabilities("editor", matrix)).toEqual([
      "mcp_servers.create_stdio",
      "namespaces.create",
    ]);
    expect(resolveCapabilities("viewer", matrix)).toEqual(["api_keys.create"]);
  });

  it("does not let editors run STDIO servers by default", () => {
    expect(resolveCapabilities("editor")).not.toContain(
      "mcp_servers.create_stdio",
    );
    expect(resolveCapabilities("editor")).toContain("mcp_servers.create");
  });

  it("lets viewers create API keys by default so they can use shared endpoints", () => {
    expect(resolveCapabilities("viewer")).toContain("api_keys.create");
    expect(resolveCapabilities("viewer")).not.toContain("namespaces.create");
  });

  it("ignores unknown capabilities coming from stored config", () => {
    const matrix = {
      editor: ["namespaces.create", "not.a.capability"],
      viewer: [],
    } as unknown as RolePermissions;
    expect(resolveCapabilities("editor", matrix)).toEqual([
      "namespaces.create",
    ]);
  });
});

describe("buildPrincipal", () => {
  it("derives role, admin flag and capabilities from groups", () => {
    const result = buildPrincipal({
      userId: "u1",
      baseRole: "viewer",
      groups: [
        { uuid: "g-team", role: null },
        { uuid: "g-admins", role: "admin" },
      ],
    });
    expect(result.role).toBe("admin");
    expect(result.isAdmin).toBe(true);
    expect(result.groupUuids).toEqual(["g-team", "g-admins"]);
    expect(result.capabilities).toEqual([...ALL_CAPABILITIES]);
  });
});

describe("hasCapability", () => {
  it("is always true for admins", () => {
    expect(
      hasCapability(
        principal({ isAdmin: true, role: "admin" }),
        "inspector.use",
      ),
    ).toBe(true);
  });

  it("checks the capability list otherwise", () => {
    const p = principal({ capabilities: ["api_keys.create"] });
    expect(hasCapability(p, "api_keys.create")).toBe(true);
    expect(hasCapability(p, "namespaces.create")).toBe(false);
  });
});

describe("canInspect", () => {
  const use = { level: "use", reason: "share" } as const;
  const edit = { level: "edit", reason: "share" } as const;

  it("denies without any access to the resource", () => {
    expect(
      canInspect(principal({ capabilities: ["inspector.use"] }), null),
    ).toBe(false);
  });

  it("requires the inspector permission for use-only access", () => {
    expect(canInspect(principal(), use)).toBe(false);
    expect(
      canInspect(principal({ capabilities: ["inspector.use"] }), use),
    ).toBe(true);
  });

  it("always lets people who can edit the resource test it", () => {
    expect(canInspect(principal(), edit)).toBe(true);
    expect(canInspect(principal(), { level: "manage", reason: "owner" })).toBe(
      true,
    );
  });
});

describe("resolveResourceAccess", () => {
  const share = (overrides: Partial<ShareGrant>): ShareGrant => ({
    userId: null,
    groupUuid: null,
    level: "use",
    ...overrides,
  });

  it("gives admins manage access on organisation resources only", () => {
    const admin = principal({ isAdmin: true, role: "admin" });
    expect(
      resolveResourceAccess({
        principal: admin,
        ownerId: null,
        shares: [],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "manage", reason: "admin" });
    // The personal resources of others: nothing without a share...
    expect(
      resolveResourceAccess({
        principal: admin,
        ownerId: "someone-else",
        shares: [],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toBeNull();
    // ...and only what a share grants, like anyone else
    expect(
      resolveResourceAccess({
        principal: admin,
        ownerId: "someone-else",
        shares: [share({ groupUuid: EVERYONE })],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "use", reason: "share" });
  });

  it("gives owners manage access", () => {
    expect(
      resolveResourceAccess({
        principal: principal(),
        ownerId: "user-1",
        shares: [],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "manage", reason: "owner" });
  });

  it("denies access to organisation resources that are not shared", () => {
    expect(
      resolveResourceAccess({
        principal: principal(),
        ownerId: null,
        shares: [],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toBeNull();
  });

  it("denies access to other users' private resources", () => {
    expect(
      resolveResourceAccess({
        principal: principal(),
        ownerId: "user-2",
        shares: [share({ userId: "user-3", level: "manage" })],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toBeNull();
  });

  it("grants the level of a direct user share", () => {
    expect(
      resolveResourceAccess({
        principal: principal(),
        ownerId: "user-2",
        shares: [share({ userId: "user-1", level: "edit" })],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "edit", reason: "share" });
  });

  it("grants access through group membership", () => {
    expect(
      resolveResourceAccess({
        principal: principal({ groupUuids: ["g-devs"] }),
        ownerId: null,
        shares: [share({ groupUuid: "g-devs", level: "use" })],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "use", reason: "share" });
  });

  it("treats every user as a member of the Everyone group", () => {
    expect(
      resolveResourceAccess({
        principal: principal(),
        ownerId: null,
        shares: [share({ groupUuid: EVERYONE, level: "use" })],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "use", reason: "share" });
  });

  it("keeps the highest level across several matching shares", () => {
    expect(
      resolveResourceAccess({
        principal: principal({ groupUuids: ["g-devs", "g-ops"] }),
        ownerId: null,
        shares: [
          share({ groupUuid: EVERYONE, level: "use" }),
          share({ groupUuid: "g-ops", level: "manage" }),
          share({ userId: "user-1", level: "edit" }),
        ],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toEqual({ level: "manage", reason: "share" });
  });

  it("ignores shares for groups the user is not in", () => {
    expect(
      resolveResourceAccess({
        principal: principal({ groupUuids: ["g-devs"] }),
        ownerId: null,
        shares: [share({ groupUuid: "g-finance", level: "manage" })],
        everyoneGroupUuid: EVERYONE,
      }),
    ).toBeNull();
  });
});
