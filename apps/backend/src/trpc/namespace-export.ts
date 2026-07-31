import {
  DatabaseNamespaceTool,
  DatabaseNamespaceWithServers,
  NAMESPACE_EXPORT_VERSION,
  NamespaceExport,
  NamespaceExportServerEntry,
  NamespaceExportToolEntry,
  NamespaceExportToolOverride,
} from "@repo/zod-types";

export interface BuildNamespaceExportOptions {
  // Injected so the timestamp is deterministic in tests. Defaults to now.
  now?: Date;
}

// Builds the portable export document for a namespace. Pure and secret-free: it
// reads only server/tool names, statuses and overrides, never server connection
// config (env / bearer token / headers). Output is deterministic for a fixed
// clock (servers sorted by name, tools by server then name, stable key order),
// so two exports of the same namespace produce byte-identical JSON.
export function buildNamespaceExport(
  namespace: DatabaseNamespaceWithServers,
  tools: DatabaseNamespaceTool[],
  options: BuildNamespaceExportOptions = {},
): NamespaceExport {
  const exportedAt = (options.now ?? new Date()).toISOString();

  const servers: NamespaceExportServerEntry[] = namespace.servers
    .map((server) => ({ name: server.name, status: server.status }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Only export tools that deviate from the default (INACTIVE or with an
  // override). Plain ACTIVE tools with no override are the default and are
  // omitted to keep the document small and decoupled from the full,
  // frequently-changing discovered-tool list.
  const exportTools: NamespaceExportToolEntry[] = tools
    .filter(isToolDeviation)
    .map(buildExportTool)
    .sort(
      (a, b) =>
        a.server.localeCompare(b.server) || a.name.localeCompare(b.name),
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

function isToolDeviation(tool: DatabaseNamespaceTool): boolean {
  return tool.status === "INACTIVE" || buildOverride(tool) !== undefined;
}

function buildExportTool(
  tool: DatabaseNamespaceTool,
): NamespaceExportToolEntry {
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
  tool: DatabaseNamespaceTool,
): NamespaceExportToolOverride | undefined {
  const override: NamespaceExportToolOverride = {};
  if (tool.overrideName != null) {
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
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}
