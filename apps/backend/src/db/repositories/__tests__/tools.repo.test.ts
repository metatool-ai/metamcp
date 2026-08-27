import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory fake of the tables ToolsRepository touches.
//   `tools`                keyed by `${mcp_server_uuid}:${name}`
//   `namespace_tool_mappings` keyed by `${namespace_uuid}:${tool_uuid}`
// The fake implements `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`
// semantics: on conflict only the keys present in `set` are merged.
//
// Drizzle query builders are thenables — `await db.insert().values().onConflictDoUpdate()`
// executes even without `.returning()`. The mock replicates that: `onConflictDoUpdate`
// returns a thenable that performs the write, and also exposes `.returning()` for the
// callers that chain it.
// ---------------------------------------------------------------------------

type ToolRow = {
  uuid: string;
  name: string;
  description: string;
  toolSchema: unknown;
  mcp_server_uuid: string;
  created_at: Date;
  updated_at: Date;
};

type MappingRow = {
  uuid: string;
  namespace_uuid: string;
  tool_uuid: string;
  mcp_server_uuid: string;
  status: "ACTIVE" | "INACTIVE";
  created_at: Date;
};

const h = vi.hoisted(() => {
  const state = {
    toolsStore: new Map<string, ToolRow>(),
    mappingsStore: new Map<string, MappingRow>(),
    toolSeq: 0,
    mappingSeq: 0,
    insertCalls: [] as any[],
    onConflictSetCalls: [] as any[],
    // Sentinel table identities shared between the `../../schema` mock and the
    // `../../index` db mock so insert() can discriminate targets by reference.
    TOOLS_TABLE: { __table: "tools" },
    NS_TOOL_MAPPINGS_TABLE: { __table: "namespace_tool_mappings" },
    NS_SERVER_MAPPINGS_TABLE: { __table: "namespace_server_mappings" },
  };

  function firstRow(values: unknown): any {
    return Array.isArray(values) ? values[0] : values;
  }

  function isSqlFragment(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      "queryChunks" in value &&
      Array.isArray((value as { queryChunks: unknown[] }).queryChunks)
    );
  }

  function makeThenable(exec: () => Promise<any[]>) {
    const thenable: any = {
      then: (resolve: (v: any[]) => void) => exec().then(resolve),
    };
    thenable.returning = () => exec();
    return thenable;
  }

  return {
    ...state,
    firstRow,
    isSqlFragment,
    makeThenable,
    reset() {
      state.toolsStore.clear();
      state.mappingsStore.clear();
      state.toolSeq = 0;
      state.mappingSeq = 0;
      state.insertCalls.length = 0;
      state.onConflictSetCalls.length = 0;
    },
  };
});

vi.mock("../../schema", () => ({
  namespaceServerMappingsTable: h.NS_SERVER_MAPPINGS_TABLE,
  namespaceToolMappingsTable: h.NS_TOOL_MAPPINGS_TABLE,
  toolsTable: h.TOOLS_TABLE,
}));

vi.mock("../../index", () => ({
  db: {
    insert: (table: unknown) => {
      const isTools = table === h.TOOLS_TABLE;

      return {
        values: (values: unknown) => {
          const first = h.firstRow(values);

          // Execute a fresh-insert or conflict-update against the fake store.
          const executeUpsert = (set: any, _target: unknown): any[] => {
            const key = isTools
              ? `${first.mcp_server_uuid}:${first.name}`
              : `${first.namespace_uuid}:${first.tool_uuid}`;
            const store = isTools ? h.toolsStore : h.mappingsStore;
            const existing = store.get(key) as ToolRow | MappingRow | undefined;

            if (existing) {
              // ON CONFLICT DO UPDATE: merge only the keys present in `set`
              // (sql`` fragments cannot be executed by the fake).
              const applicable: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(
                set as Record<string, unknown>,
              )) {
                if (h.isSqlFragment(v)) continue;
                applicable[k] = v;
              }
              const updated = { ...existing, ...applicable };
              store.set(key, updated as ToolRow & MappingRow);
              return [updated];
            }

            // Fresh insert: schema-defaulted columns filled with defaults.
            if (isTools) {
              const row: ToolRow = {
                uuid: `tool-uuid-${++h.toolSeq}`,
                name: first.name,
                description: first.description ?? "",
                toolSchema: first.toolSchema ?? {},
                mcp_server_uuid: first.mcp_server_uuid,
                created_at: new Date(),
                updated_at: new Date(),
              };
              h.toolsStore.set(key, row);
              return [row];
            }
            const row: MappingRow = {
              uuid: `mapping-uuid-${++h.mappingSeq}`,
              namespace_uuid: first.namespace_uuid,
              tool_uuid: first.tool_uuid,
              mcp_server_uuid: first.mcp_server_uuid,
              status: first.status ?? "ACTIVE",
              created_at: new Date(),
            };
            h.mappingsStore.set(key, row);
            return [row];
          };

          // bulkUpsert's no-conflict insert path (`.values().returning()`).
          const executePlainInsert = (): any[] => {
            const row: ToolRow = {
              uuid: `tool-uuid-${++h.toolSeq}`,
              name: first.name,
              description: first.description ?? "",
              toolSchema: first.toolSchema ?? {},
              mcp_server_uuid: first.mcp_server_uuid,
              created_at: new Date(),
              updated_at: new Date(),
            };
            h.toolsStore.set(`${first.mcp_server_uuid}:${first.name}`, row);
            return [row];
          };

          return {
            onConflictDoUpdate: ({
              target,
              set,
            }: {
              target: unknown;
              set: any;
            }) => {
              h.insertCalls.push({ isTools, values, target, set });
              h.onConflictSetCalls.push(set);
              return h.makeThenable(() =>
                Promise.resolve(executeUpsert(set, target)),
              );
            },
            returning: () =>
              h.makeThenable(() => Promise.resolve(executePlainInsert())),
          };
        },
      };
    },
    delete: () => ({
      where: () => ({
        returning: async () => [],
      }),
    }),
  },
}));

// Import AFTER vi.mock so the repo binds to the fake db.
const { ToolsRepository } = await import("../tools.repo");

/**
 * Mirror of NamespaceMappingsRepository.updateToolStatus against the fake
 * store — the real repo method is exercised elsewhere; the sync regression
 * only needs the write that the admin UI performs to stick.
 */
async function setMappingStatus(
  namespaceUuid: string,
  toolUuid: string,
  status: "ACTIVE" | "INACTIVE",
) {
  const key = `${namespaceUuid}:${toolUuid}`;
  const mapping = h.mappingsStore.get(key);
  if (!mapping) return undefined;
  const updated = { ...mapping, status };
  h.mappingsStore.set(key, updated);
  return updated;
}

describe("ToolsRepository.syncTools — preserves operator-set mapping status", () => {
  const repo = new ToolsRepository();
  const namespaceUuid = "00000000-0000-0000-0000-0000000000aa";
  const serverUuid = "00000000-0000-0000-0000-0000000000bb";

  const readFileTool = {
    name: "filesystem__read_file",
    description: "read a file",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  };

  beforeEach(() => {
    h.reset();
  });

  it("syncTools must NOT re-activate a mapping the operator set to INACTIVE", async () => {
    // 1. First sync: tool appears for the first time → mapping created ACTIVE.
    const first = await repo.syncTools(
      {
        mcpServerUuid: serverUuid,
        tools: [readFileTool],
      },
      namespaceUuid,
    );

    const toolUuid = first.upserted[0]?.uuid;
    expect(toolUuid).toBeDefined();
    expect(h.mappingsStore.get(`${namespaceUuid}:${toolUuid}`)?.status).toBe(
      "ACTIVE",
    );

    // 2. Operator disables the tool (the admin updateToolStatus write path).
    const updated = await setMappingStatus(namespaceUuid, toolUuid, "INACTIVE");
    expect(updated?.status).toBe("INACTIVE");

    // 3. Next background sync pass with the SAME namespace + tools.
    await repo.syncTools(
      {
        mcpServerUuid: serverUuid,
        tools: [readFileTool],
      },
      namespaceUuid,
    );

    // 4. The operator's INACTIVE status must survive the sync.
    const after = h.mappingsStore.get(`${namespaceUuid}:${toolUuid}`);
    expect(after?.status).toBe("INACTIVE");
  });

  it("syncTools inserts NEW mappings as ACTIVE (no operator intent yet)", async () => {
    const result = await repo.syncTools(
      {
        mcpServerUuid: serverUuid,
        tools: [readFileTool],
      },
      namespaceUuid,
    );

    const toolUuid = result.upserted[0]?.uuid;
    expect(toolUuid).toBeDefined();
    expect(h.mappingsStore.get(`${namespaceUuid}:${toolUuid}`)?.status).toBe(
      "ACTIVE",
    );
  });

  it("conflict-update SET must NOT re-assert ACTIVE", async () => {
    await repo.syncTools(
      {
        mcpServerUuid: serverUuid,
        tools: [readFileTool],
      },
      namespaceUuid,
    );

    const storedTool = h.toolsStore.get(`${serverUuid}:${readFileTool.name}`);
    if (!storedTool) {
      throw new Error("Expected stored tool to exist before disabling");
    }
    const toolUuid = storedTool.uuid;
    await setMappingStatus(namespaceUuid, toolUuid, "INACTIVE");

    await repo.syncTools(
      {
        mcpServerUuid: serverUuid,
        tools: [readFileTool],
      },
      namespaceUuid,
    );

    // The mapping upsert's conflict SET must not contain a hardcoded ACTIVE.
    const mappingSets = h.onConflictSetCalls.filter(
      (_set, idx) => h.insertCalls[idx]?.isTools === false,
    );
    const secondMappingSet = mappingSets[1];
    expect(secondMappingSet).toBeDefined();
    // Status must be absent OR a self-assign sql`` fragment — never the literal
    // string "ACTIVE".
    expect(secondMappingSet.status).not.toBe("ACTIVE");
  });
});
