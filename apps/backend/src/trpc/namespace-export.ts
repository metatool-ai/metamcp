import {
  DatabaseNamespace,
  NAMESPACE_EXPORT_VERSION,
  NamespaceExport,
  NamespaceExportServerEntry,
  NamespaceExportSnapshot,
  NamespaceExportToolEntry,
  NamespaceExportToolOverride,
} from "@repo/zod-types";

type ExportNamespaceSource = Pick<DatabaseNamespace, "name" | "description"> & {
  servers: NamespaceExportSnapshot["servers"];
};
type ExportToolSource = NamespaceExportSnapshot["tools"][number];

export interface BuildNamespaceExportOptions {
  // Injected so the timestamp is deterministic in tests. Defaults to now.
  now?: Date;
}

// Builds the portable export document for a namespace. Pure and secret-free: it
// reads only server/tool names, statuses and overrides, never server connection
// config (env / bearer token / headers). The `namespace` body is deterministic:
// it is byte-identical across exports of an unchanged namespace (servers sorted
// by name, tools by server then name, stable key order, sorted annotation keys,
// locale-independent comparison). Only the top-level `exportedAt` provenance
// timestamp varies between exports.
export function buildNamespaceExport(
  namespace: ExportNamespaceSource,
  tools: ExportToolSource[],
  options: BuildNamespaceExportOptions = {},
): NamespaceExport {
  const exportedAt = (options.now ?? new Date()).toISOString();

  // Sorting compares every exported field, not just the name. A namespace can
  // legitimately hold two servers with the same name (server names are unique
  // per user, so a public server and the caller's own private server may share
  // one), and the underlying query has no ORDER BY. Ordering on name alone
  // would leave those entries in database row order, which Postgres does not
  // guarantee. With a total order over the exported content, entries that still
  // tie are byte-identical, so their order cannot change the output.
  const servers: NamespaceExportServerEntry[] = namespace.servers
    .map((server) => ({ name: server.name, status: server.status }))
    .sort(
      (a, b) =>
        compareStrings(a.name, b.name) || compareStrings(a.status, b.status),
    );

  // Export only tools that deviate from the default (INACTIVE or with an
  // override). Plain ACTIVE tools with no override are the default and are
  // omitted to keep the document small and decoupled from the full,
  // frequently-changing discovered-tool list. Build each entry once (which
  // resolves the override) before filtering, so the override is not computed
  // twice per tool.
  const exportTools: NamespaceExportToolEntry[] = tools
    .map(buildExportTool)
    .filter((tool) => tool.status === "INACTIVE" || tool.override !== undefined)
    .sort(
      (a, b) =>
        compareStrings(a.server, b.server) ||
        compareStrings(a.name, b.name) ||
        compareStrings(a.status, b.status) ||
        compareStrings(serializeOverride(a), serializeOverride(b)),
    );

  return {
    version: NAMESPACE_EXPORT_VERSION,
    exportedAt,
    namespace: {
      name: namespace.name,
      ...(namespace.description ? { description: namespace.description } : {}),
      servers,
      tools: exportTools,
    },
  };
}

// Locale-independent string comparison (code-unit order) so the ordering is
// stable across Node runtimes and instances, not dependent on the ambient ICU
// locale. This matters because the document is meant to be portable.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Last-resort tiebreaker for tools that match on server, name and status. The
// override already has sorted keys and a fixed field order, so serializing it
// yields a stable comparison key.
function serializeOverride(tool: NamespaceExportToolEntry): string {
  return JSON.stringify(tool.override ?? null);
}

function buildExportTool(tool: ExportToolSource): NamespaceExportToolEntry {
  const override = buildOverride(tool);
  return {
    server: tool.serverName,
    name: tool.name,
    status: tool.status,
    ...(override ? { override } : {}),
  };
}

// Collects the non-null override fields into a compact object, omitting empty
// annotations. Returns undefined when there is no override at all.
function buildOverride(
  tool: ExportToolSource,
): NamespaceExportToolOverride | undefined {
  const override: NamespaceExportToolOverride = {};
  // A blank name is ignored at runtime (tool-overrides.functional.ts), so it is
  // not a real override and is not exported.
  if (tool.overrideName != null && tool.overrideName.trim() !== "") {
    override.name = tool.overrideName;
  }
  if (tool.overrideTitle != null) {
    override.title = tool.overrideTitle;
  }
  if (tool.overrideDescription != null) {
    override.description = tool.overrideDescription;
  }
  if (
    tool.overrideAnnotations != null &&
    Object.keys(tool.overrideAnnotations).length > 0
  ) {
    // Sort keys so the annotations passthrough is byte-identical regardless of
    // the key order the object happens to arrive in (the rest of the document
    // already has a fixed key order).
    override.annotations = sortKeysDeep(tool.overrideAnnotations) as Record<
      string,
      unknown
    >;
  }
  return Object.keys(override).length > 0 ? override : undefined;
}

// Recursively sorts object keys so equal data serializes identically. Arrays
// keep their order; primitives are returned as-is.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    // Object.fromEntries defines own properties, so a "__proto__" key from
    // JSONB is kept as data instead of changing the prototype.
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          sortKeysDeep((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}
