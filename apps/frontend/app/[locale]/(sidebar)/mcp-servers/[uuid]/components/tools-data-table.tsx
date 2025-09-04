"use client";

import { Tool } from "@repo/zod-types";
import {
  Calendar,
  ChevronDownIcon,
  ChevronUpIcon,
  Database,
  Eye,
  EyeOff,
  Hash,
  MoreHorizontal,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";

// MCP Tool type from the protocol
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// Enhanced tool type that combines DB tools and MCP tools
interface EnhancedTool {
  // Required fields that both types have
  name: string;
  description?: string | null;

  // Optional fields from DB
  uuid?: string;
  created_at?: string;
  updated_at?: string;
  mcp_server_uuid?: string;
  toolSchema?: Record<string, unknown>;

  // MCP-specific fields
  inputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };

  // Source tracking - can be from database, MCP, or both
  sources: {
    database: boolean;
    mcp: boolean;
  };
  isTemporary?: boolean; // For tools that are fetched from MCP but not yet saved
}

interface UnifiedToolsTableProps {
  dbTools: Tool[];
  mcpTools: MCPTool[];
  mcpServerUuid: string;
  loading?: boolean;
  onRefreshMcpTools?: () => void;
}

type SortField = "name" | "description" | "updated_at";
type SortDirection = "asc" | "desc";

export function UnifiedToolsTable({
  dbTools,
  mcpTools,
  loading = false,
  onRefreshMcpTools,
}: UnifiedToolsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const { t } = useTranslations();

  // Combine and enhance tools from both sources
  const enhancedTools: EnhancedTool[] = (() => {
    const toolMap = new Map<string, EnhancedTool>();

    // First, add all database tools
    dbTools.forEach((tool) => {
      toolMap.set(tool.name, {
        ...tool,
        sources: {
          database: true,
          mcp: false,
        },
      });
    });

    // Then, add or update with MCP tools
    mcpTools.forEach((mcpTool) => {
      const existingTool = toolMap.get(mcpTool.name);

      if (existingTool) {
        // Tool exists in database, mark it as also available in MCP
        existingTool.sources.mcp = true;
        // Update MCP-specific fields if available
        if (mcpTool.inputSchema) {
          existingTool.inputSchema = mcpTool.inputSchema;
        }
        if (mcpTool.description && !existingTool.description) {
          existingTool.description = mcpTool.description;
        }
      } else {
        // Tool only exists in MCP, add as new
        toolMap.set(mcpTool.name, {
          name: mcpTool.name,
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          sources: {
            database: false,
            mcp: true,
          },
          isTemporary: true,
        });
      }
    });

    return Array.from(toolMap.values());
  })();

  // Handle sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Filter and sort tools
  const filteredAndSortedTools = useMemo(() => {
    let filtered = enhancedTools;

    // Apply search filter
    if (searchTerm) {
      filtered = enhancedTools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tool.description?.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue = a[sortField] || "";
      let bValue = b[sortField] || "";

      // Handle string comparison
      if (typeof aValue === "string" && typeof bValue === "string") {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) {
        return sortDirection === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortDirection === "asc" ? 1 : -1;
      }
      return 0;
    });

    return filtered;
  }, [enhancedTools, searchTerm, sortField, sortDirection]);

  // Render sort icon
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === "asc" ? (
      <ChevronUpIcon className="h-3 w-3 ml-1" />
    ) : (
      <ChevronDownIcon className="h-3 w-3 ml-1" />
    );
  };

  // Toggle row expansion
  const toggleRowExpansion = (toolId: string) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(toolId)) {
        newSet.delete(toolId);
      } else {
        newSet.add(toolId);
      }
      return newSet;
    });
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get source badge(s)
  const getSourceBadge = (tool: EnhancedTool) => {
    const badges = [];

    if (tool.sources.mcp) {
      badges.push(
        <Badge key="mcp" variant="info" className="gap-1">
          <Wrench className="h-3 w-3" />
          {t("mcp-servers:tools.mcp")}
        </Badge>,
      );
    }

    if (tool.sources.database) {
      badges.push(
        <Badge key="database" variant="success" className="gap-1">
          <Database className="h-3 w-3" />
          {t("mcp-servers:tools.saved")}
        </Badge>,
      );
    }

    if (badges.length > 1) {
      return <div className="flex items-center gap-1">{badges}</div>;
    }

    return (
      badges[0] || (
        <Badge variant="neutral" className="gap-1">
          <Wrench className="h-3 w-3" />
          {t("mcp-servers:tools.unknown")}
        </Badge>
      )
    );
  };

  // Get tool parameters from schema
  const getToolParameters = (tool: EnhancedTool) => {
    const schema = (tool.toolSchema || tool.inputSchema) as Record<
      string,
      unknown
    >;
    if (!schema || !schema.properties) return [];

    return Object.entries(
      schema.properties as Record<string, Record<string, unknown>>,
    ).map(([key, value]: [string, Record<string, unknown>]) => ({
      name: key,
      type: (value.type as string) || "unknown",
      description: (value.description as string) || "",
      required: (schema.required as string[])?.includes(key) || false,
    }));
  };

  // Get tool ID for expansion
  const getToolId = (tool: EnhancedTool) => {
    return tool.uuid || `mcp-${tool.name}`;
  };

  if (filteredAndSortedTools.length === 0 && !searchTerm) {
    return (
      <div className="p-8 text-center">
        <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          {t("mcp-servers:tools.noToolsFoundDescription")}
        </p>
        {onRefreshMcpTools && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshMcpTools}
            disabled={loading}
            className="mt-3"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {t("mcp-servers:tools.refreshTools")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      {/* Search Bar */}
      <div className="flex items-center gap-2 px-2 mt-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("mcp-servers:tools.searchTools")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {t("mcp-servers:tools.toolsCount", {
            count: filteredAndSortedTools.length,
            total: enhancedTools.length,
          })}
        </div>
      </div>

      {filteredAndSortedTools.length === 0 ? (
        <div className="p-8 text-center">
          <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <h4 className="text-sm font-medium">
            {searchTerm
              ? t("mcp-servers:tools.noToolsMatch")
              : t("mcp-servers:tools.noToolsFound")}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {searchTerm
              ? t("mcp-servers:tools.noToolsMatchDescription")
              : t("mcp-servers:tools.noToolsFoundDescription")}
          </p>
          {searchTerm ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchTerm("")}
              className="mt-2"
            >
              {t("mcp-servers:tools.clearSearch")}
            </Button>
          ) : (
            onRefreshMcpTools && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefreshMcpTools}
                disabled={loading}
                className="mt-3"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                {t("mcp-servers:tools.refreshTools")}
              </Button>
            )
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  onClick={() => handleSort("name")}
                  className="h-auto p-0 font-medium hover:bg-transparent"
                >
                  {t("mcp-servers:tools.toolName")}
                  {renderSortIcon("name")}
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  onClick={() => handleSort("description")}
                  className="h-auto p-0 font-medium hover:bg-transparent"
                >
                  {t("mcp-servers:tools.description")}
                  {renderSortIcon("description")}
                </Button>
              </TableHead>
              <TableHead>{t("mcp-servers:tools.source")}</TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  onClick={() => handleSort("updated_at")}
                  className="h-auto p-0 font-medium hover:bg-transparent"
                >
                  {t("mcp-servers:tools.updatedAt")}
                  {renderSortIcon("updated_at")}
                </Button>
              </TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedTools.map((tool) => {
              const toolId = getToolId(tool);
              const isExpanded = expandedRows.has(toolId);
              const parameters = getToolParameters(tool);

              return (
                <React.Fragment key={toolId}>
                  {/* Main row */}
                  <TableRow className="group">
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => toggleRowExpansion(toolId)}
                      >
                        {isExpanded ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
                    </TableCell>

                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-blue-500" />
                        <span>{tool.name}</span>
                        {tool.isTemporary && !tool.sources.database && (
                          <span className="text-xs text-amber-600">
                            ({t("mcp-servers:tools.new")})
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="max-w-md">
                        {tool.description ? (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {tool.description}
                          </p>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">
                            {t("mcp-servers:tools.noDescription")}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>{getSourceBadge(tool)}</TableCell>

                    <TableCell>
                      {tool.updated_at ? (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {formatDate(tool.updated_at)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">
                          {t("mcp-servers:tools.notSaved")}
                        </span>
                      )}
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => toggleRowExpansion(toolId)}
                          >
                            {isExpanded ? (
                              <>
                                <EyeOff className="mr-2 h-4 w-4" />
                                {t("mcp-servers:tools.hideDetails")}
                              </>
                            ) : (
                              <>
                                <Eye className="mr-2 h-4 w-4" />
                                {t("mcp-servers:tools.showDetails")}
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>

                  {/* Expanded details row */}
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/50">
                        <div className="py-4 space-y-4">
                          {/* Tool Info */}
                          <div className="flex items-center gap-4">
                            {tool.uuid && (
                              <div className="flex items-center gap-2">
                                <Hash className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                  {t("mcp-servers:tools.uuid")}:
                                </span>
                                <code className="text-sm bg-background px-2 py-1 rounded border">
                                  {tool.uuid}
                                </code>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {t("mcp-servers:tools.source")}:
                              </span>
                              {getSourceBadge(tool)}
                            </div>
                          </div>

                          {/* Tool Schema */}
                          <div>
                            <h5 className="text-sm font-medium mb-2">
                              {t("mcp-servers:tools.toolSchema")}
                            </h5>
                            <div className="bg-background p-3 rounded border">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs font-medium">
                                  {t("mcp-servers:tools.type")}:
                                </span>
                                <code className="text-xs bg-muted px-2 py-1 rounded">
                                  {String(
                                    tool.toolSchema?.type ||
                                      tool.inputSchema?.type ||
                                      "object",
                                  )}
                                </code>
                              </div>

                              {parameters.length > 0 && (
                                <div>
                                  <span className="text-xs font-medium">
                                    {t("mcp-servers:tools.parameters")}:
                                  </span>
                                  <div className="mt-2 space-y-2">
                                    {parameters.map((param, index) => (
                                      <div
                                        key={index}
                                        className="flex items-center gap-2 text-xs"
                                      >
                                        <div className="flex items-center gap-1">
                                          <code className="bg-muted px-2 py-1 rounded font-mono">
                                            {param.name}
                                          </code>
                                          <span className="text-muted-foreground">
                                            ({param.type})
                                          </span>
                                          {param.required && (
                                            <span className="text-red-500 text-xs">
                                              *
                                            </span>
                                          )}
                                        </div>
                                        {param.description && (
                                          <span className="text-muted-foreground">
                                            - {param.description}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Full Schema JSON (for debugging) */}
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                              {t("mcp-servers:tools.showFullSchema")}
                            </summary>
                            <div className="mt-2">
                              <CodeBlock
                                language="json"
                                maxHeight="300px"
                                className="text-xs"
                              >
                                {JSON.stringify(
                                  tool.toolSchema || tool.inputSchema,
                                  null,
                                  2,
                                )}
                              </CodeBlock>
                            </div>
                          </details>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
