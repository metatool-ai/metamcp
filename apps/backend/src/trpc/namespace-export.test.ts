import type {
  DatabaseNamespaceTool,
  DatabaseNamespaceWithServers,
} from "@repo/zod-types";
import { describe, expect, it } from "vitest";

import { buildNamespaceExport } from "./namespace-export";

const FIXED_NOW = new Date("2026-07-31T10:00:00.000Z");

function makeServer(
  overrides: Partial<DatabaseNamespaceWithServers["servers"][number]> = {},
): DatabaseNamespaceWithServers["servers"][number] {
  return {
    uuid: "server-uuid",
    name: "github",
    description: null,
    type: "STDIO",
    command: "node",
    args: [],
    url: null,
    env: {},
    bearerToken: null,
    headers: {},
    forward_headers: {},
    created_at: FIXED_NOW,
    user_id: "user-1",
    status: "ACTIVE",
    ...overrides,
  };
}

function makeNamespace(
  overrides: Partial<DatabaseNamespaceWithServers> = {},
): DatabaseNamespaceWithServers {
  return {
    uuid: "ns-uuid",
    name: "release-manager",
    description: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    user_id: "user-1",
    servers: [],
    ...overrides,
  };
}

function makeTool(
  overrides: Partial<DatabaseNamespaceTool> = {},
): DatabaseNamespaceTool {
  return {
    uuid: "tool-uuid",
    name: "create_pull_request",
    description: "Create a PR",
    toolSchema: { type: "object", properties: {} },
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    mcp_server_uuid: "server-uuid",
    status: "ACTIVE",
    serverName: "github",
    serverUuid: "server-uuid",
    overrideName: null,
    overrideTitle: null,
    overrideDescription: null,
    overrideAnnotations: null,
    ...overrides,
  };
}

describe("buildNamespaceExport", () => {
  it("exports servers, active/inactive tools and overrides", () => {
    const namespace = makeNamespace({
      description: "Tools for release coordination",
      servers: [
        makeServer({ name: "github", status: "ACTIVE" }),
        makeServer({ name: "jira", status: "INACTIVE", uuid: "jira-uuid" }),
      ],
    });
    const tools: DatabaseNamespaceTool[] = [
      // Plain ACTIVE, no override -> omitted (default state).
      makeTool({ name: "list_issues", status: "ACTIVE" }),
      // Override present -> included.
      makeTool({
        name: "create_pull_request",
        status: "ACTIVE",
        overrideDescription: "Create a PR into the release branch.",
        overrideAnnotations: { readOnlyHint: false },
      }),
      // INACTIVE -> included.
      makeTool({ name: "delete_repository", status: "INACTIVE" }),
    ];

    const result = buildNamespaceExport(namespace, tools, { now: FIXED_NOW });

    expect(result).toEqual({
      version: 1,
      exportedAt: "2026-07-31T10:00:00.000Z",
      namespace: {
        name: "release-manager",
        description: "Tools for release coordination",
        servers: [
          { name: "github", status: "ACTIVE" },
          { name: "jira", status: "INACTIVE" },
        ],
        tools: [
          {
            server: "github",
            name: "create_pull_request",
            status: "ACTIVE",
            override: {
              description: "Create a PR into the release branch.",
              annotations: { readOnlyHint: false },
            },
          },
          {
            server: "github",
            name: "delete_repository",
            status: "INACTIVE",
          },
        ],
      },
    });
  });

  it("exports an empty namespace", () => {
    const result = buildNamespaceExport(makeNamespace(), [], {
      now: FIXED_NOW,
    });

    expect(result).toEqual({
      version: 1,
      exportedAt: "2026-07-31T10:00:00.000Z",
      namespace: {
        name: "release-manager",
        servers: [],
        tools: [],
      },
    });
  });

  it("never includes secret material", () => {
    const namespace = makeNamespace({
      servers: [
        makeServer({
          name: "github",
          env: { GITHUB_TOKEN: "super-secret-env-value" },
          bearerToken: "super-secret-bearer-token",
          headers: { Authorization: "Bearer super-secret-header" },
        }),
      ],
    });

    const json = JSON.stringify(
      buildNamespaceExport(namespace, [], { now: FIXED_NOW }),
    );

    expect(json).not.toContain("super-secret-env-value");
    expect(json).not.toContain("super-secret-bearer-token");
    expect(json).not.toContain("super-secret-header");
    expect(json).not.toContain("GITHUB_TOKEN");
    expect(json).not.toContain("bearerToken");
    expect(json).not.toContain("headers");
    expect(json).not.toContain("env");
  });

  it("produces deterministic, sorted, byte-identical output", () => {
    const namespace = makeNamespace({
      servers: [
        makeServer({ name: "jira", uuid: "jira-uuid" }),
        makeServer({ name: "github", uuid: "github-uuid" }),
      ],
    });
    const tools: DatabaseNamespaceTool[] = [
      makeTool({
        serverName: "jira",
        name: "create_issue",
        status: "INACTIVE",
      }),
      makeTool({
        serverName: "github",
        name: "delete_repository",
        status: "INACTIVE",
      }),
      makeTool({
        serverName: "github",
        name: "create_pull_request",
        status: "INACTIVE",
      }),
    ];

    const first = JSON.stringify(
      buildNamespaceExport(namespace, tools, { now: FIXED_NOW }),
      null,
      2,
    );
    const second = JSON.stringify(
      buildNamespaceExport(namespace, tools, { now: FIXED_NOW }),
      null,
      2,
    );

    expect(first).toBe(second);

    const parsed = JSON.parse(first);
    expect(
      parsed.namespace.servers.map((s: { name: string }) => s.name),
    ).toEqual(["github", "jira"]);
    expect(
      parsed.namespace.tools.map(
        (t: { server: string; name: string }) => `${t.server}/${t.name}`,
      ),
    ).toEqual([
      "github/create_pull_request",
      "github/delete_repository",
      "jira/create_issue",
    ]);
  });

  it("keeps the namespace body identical regardless of the export clock", () => {
    const namespace = makeNamespace({
      servers: [makeServer({ name: "github" })],
    });
    const tools: DatabaseNamespaceTool[] = [
      makeTool({ name: "delete_repository", status: "INACTIVE" }),
    ];

    const a = buildNamespaceExport(namespace, tools, {
      now: new Date("2026-07-31T10:00:00.000Z"),
    });
    const b = buildNamespaceExport(namespace, tools, {
      now: new Date("2027-01-01T00:00:00.000Z"),
    });

    // Only exportedAt varies; the reviewable body is byte-identical.
    expect(a.exportedAt).not.toBe(b.exportedAt);
    expect(JSON.stringify(a.namespace)).toBe(JSON.stringify(b.namespace));
  });

  it("sorts override annotation keys for stable output", () => {
    const namespace = makeNamespace({
      servers: [makeServer({ name: "github" })],
    });
    const tools: DatabaseNamespaceTool[] = [
      makeTool({
        name: "create_pull_request",
        overrideAnnotations: {
          readOnlyHint: false,
          destructiveHint: true,
          annotationTitle: "PR",
        },
      }),
    ];

    const result = buildNamespaceExport(namespace, tools, { now: FIXED_NOW });

    const annotations = result.namespace.tools[0]?.override?.annotations ?? {};
    expect(Object.keys(annotations)).toEqual([
      "annotationTitle",
      "destructiveHint",
      "readOnlyHint",
    ]);
  });
});
