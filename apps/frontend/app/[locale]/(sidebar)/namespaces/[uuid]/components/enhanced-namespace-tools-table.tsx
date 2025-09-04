"use client";

import { NamespaceTool, ToolStatusEnum } from "@repo/zod-types";
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
  Server,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

// MCP Tool type from MetaMCP
interface MCPTool {
  name: string; // Contains "ServerName__toolName" format
  description?: string;
  inputSchema: Record<string, unknown>;
}

// Enhanced tool type that combines saved and MCP tools
interface EnhancedNamespaceTool {
  // Common fields
  name: string; // The actual tool name (without server prefix)
  description?: string | null;
  toolSchema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;

  // Saved tool specific fields
  uuid?: string;
  created_at?: string;
  updated_at?: string;
  mcp_server_uuid?: string;
  status?: string;
  serverName?: string;
  serverUuid?: string;

  // Source tracking
  sources: {
    metamcp: boolean;
    saved: boolean;
  };
  isTemporary?: boolean; // For tools that are fetched from MetaMCP but not yet saved
}

interface EnhancedNamespaceToolsTableProps {
  savedTools: NamespaceTool[];
  mcpTools: MCPTool[];
  loading?: boolean;
  autoSaving?: boolean;
  onRefreshTools?: () => void;
  namespaceUuid: string;
  servers: Array<{
    uuid: string;
    name: string;
    status: string;
  }>;
}

type SortField =
  | "name"
  | "serverName"
  | "status"
  | "description"
  | "updated_at";
type SortDirection = "asc" | "desc";

export function EnhancedNamespaceToolsTable({
  savedTools,
  mcpTools,
  loading = false,
  autoSaving = false,
  onRefreshTools,
  namespaceUuid,
  servers,
}: EnhancedNamespaceToolsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Get translations
  const { t } = useTranslations();

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Use namespace-specific tool status update mutation
  const updateToolStatusMutation =
    trpc.frontend.namespaces.updateToolStatus.useMutation({
      onSuccess: (response) => {
        if (response.success) {
          toast.success(t("namespaces:enhancedToolsTable.toolStatusUpdated"));
          // Invalidate the namespace tools query to refresh the data
          utils.frontend.namespaces.getTools.invalidate({ namespaceUuid });
        } else {
          toast.error(
            t("namespaces:enhancedToolsTable.toolStatusUpdateFailed"),
          );
        }
      },
      onError: (error) => {
        console.error("Error updating tool status:", error);
        toast.error(t("namespaces:enhancedToolsTable.toolStatusUpdateFailed"), {
          description: error.message,
        });
      },
    });

  // Combine and enhance tools from both sources
  const enhancedTools: EnhancedNamespaceTool[] = useMemo(() => {
    const toolMap = new Map<string, EnhancedNamespaceTool>();

    // Create a map of server names to their status for quick lookup
    const serverStatusMap = new Map<string, string>();
    servers.forEach((server) => {
      serverStatusMap.set(server.name, server.status);
    });

    // Helper function to create a unique key for tools (toolName + serverName)
    const createToolKey = (toolName: string, serverName: string) => {
      return `${serverName}__${toolName}`;
    };

    // First, add all saved tools, but only if their server is active
    savedTools.forEach((tool) => {
      const serverStatus = serverStatusMap.get(tool.serverName);
      // Only include tools from active servers
      if (serverStatus === "ACTIVE") {
        const toolKey = createToolKey(tool.name, tool.serverName);
        toolMap.set(toolKey, {
          ...tool,
          sources: {
            metamcp: false, // Will be set to true only if currently available from MetaMCP
            saved: true,
          },
        });
      }
    });

    // Get list of actual server names from saved tools for validation
    const actualServerNames = new Set(
      savedTools.map((tool) => tool.serverName),
    );

    // Then, add or update with MetaMCP tools, but only if their server is active
    mcpTools.forEach((mcpTool) => {
      // Parse the tool name to extract server name and actual tool name
      const lastDoubleUnderscoreIndex = mcpTool.name.lastIndexOf("__");

      if (lastDoubleUnderscoreIndex === -1) {
        console.warn(`Invalid tool name format: ${mcpTool.name}`);
        return;
      }

      let serverName = mcpTool.name.substring(0, lastDoubleUnderscoreIndex);
      let toolName = mcpTool.name.substring(lastDoubleUnderscoreIndex + 2);

      // Handle nested MetaMCP scenarios
      // If the extracted server name doesn't exist in our actual servers list,
      // it might be a nested MetaMCP name like "ParentServer__ChildServer"
      if (!actualServerNames.has(serverName) && serverName.includes("__")) {
        const firstDoubleUnderscoreIndex = serverName.indexOf("__");
        const actualServerName = serverName.substring(
          0,
          firstDoubleUnderscoreIndex,
        );

        if (actualServerNames.has(actualServerName)) {
          // This is a nested MetaMCP tool - adjust parsing
          const nestedPart = serverName.substring(
            firstDoubleUnderscoreIndex + 2,
          );
          serverName = actualServerName;
          toolName = `${nestedPart}__${toolName}`;
        }
      }

      // Check if the server for this tool is active
      const serverStatus = serverStatusMap.get(serverName);
      if (serverStatus !== "ACTIVE") {
        // Skip tools from inactive servers
        return;
      }

      const toolKey = createToolKey(toolName, serverName);
      const existingTool = toolMap.get(toolKey);

      if (existingTool) {
        // Tool exists in saved tools, mark it as currently available in MetaMCP
        existingTool.sources.metamcp = true;
        // Update MetaMCP-specific fields if available
        if (mcpTool.inputSchema) {
          existingTool.inputSchema = mcpTool.inputSchema;
        }
        if (mcpTool.description && !existingTool.description) {
          existingTool.description = mcpTool.description;
        }
      } else {
        // Tool only exists in MetaMCP, add as new
        toolMap.set(toolKey, {
          name: toolName,
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          serverName: serverName,
          sources: {
            metamcp: true,
            saved: false,
          },
          isTemporary: true,
        });
      }
    });

    return Array.from(toolMap.values());
  }, [savedTools, mcpTools, servers]);

  // Handle status toggle (only for saved tools)
  const handleStatusToggle = async (tool: EnhancedNamespaceTool) => {
    if (!tool.sources.saved || !tool.uuid || !tool.serverUuid) {
      toast.error(t("namespaces:enhancedToolsTable.cannotToggleStatus"));
      return;
    }

    const newStatus =
      tool.status === ToolStatusEnum.Enum.ACTIVE
        ? ToolStatusEnum.Enum.INACTIVE
        : ToolStatusEnum.Enum.ACTIVE;

    updateToolStatusMutation.mutate({
      namespaceUuid,
      toolUuid: tool.uuid,
      serverUuid: tool.serverUuid,
      status: newStatus,
    });
  };

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
          tool.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tool.serverName?.toLowerCase().includes(searchTerm.toLowerCase()),
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

  // Get source badge(s)
  const getSourceBadge = (tool: EnhancedNamespaceTool) => {
    const badges = [];

    if (tool.sources.metamcp) {
      badges.push(
        <Badge key="metamcp" variant="info" className="gap-1">
          <Wrench className="h-3 w-3" />
          {t("namespaces:enhancedToolsTable.sources.metamcp")}
        </Badge>,
      );
    }

    if (tool.sources.saved) {
      badges.push(
        <Badge key="saved" variant="success" className="gap-1">
          <Database className="h-3 w-3" />
          {t("namespaces:enhancedToolsTable.sources.saved")}
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
          {t("namespaces:enhancedToolsTable.sources.unknown")}
        </Badge>
      )
    );
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

  // Get tool parameters from schema
  const getToolParameters = (tool: EnhancedNamespaceTool) => {
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

  // Generate tool ID for expansion
  const getToolId = (tool: EnhancedNamespaceTool) => {
    return tool.uuid || `mcp-${tool.name}`;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="space-y-3">
          {/* Search bar skeleton */}
          <div className="h-10 bg-gray-200 rounded animate-pulse" />
          {/* Table header skeleton */}
          <div className="flex space-x-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="h-10 bg-gray-200 rounded flex-1 animate-pulse"
              />
            ))}
          </div>
          {/* Table rows skeleton */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex space-x-4">
              {Array.from({ length: 7 }).map((_, j) => (
                <div
                  key={j}
                  className="h-8 bg-gray-100 rounded flex-1 animate-pulse"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (filteredAndSortedTools.length === 0 && !searchTerm) {
    return (
      <div className="p-8 text-center">
        <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          {t("namespaces:enhancedToolsTable.noToolsFound")}
        </p>
        {onRefreshTools && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshTools}
            disabled={loading}
            className="mt-3"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {t("namespaces:enhancedToolsTable.refreshTools")}
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
            placeholder={t("namespaces:enhancedToolsTable.searchTools")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">
            {t("namespaces:enhancedToolsTable.toolsCount", {
              count: filteredAndSortedTools.length,
              total: enhancedTools.length,
            })}
          </div>
          {autoSaving && (
            <div className="flex items-center gap-1 text-xs text-blue-600">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>{t("namespaces:enhancedToolsTable.autoSaving")}</span>
            </div>
          )}
        </div>
      </div>

      {filteredAndSortedTools.length === 0 ? (
        <div className="p-8 text-center">
          <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <h4 className="text-sm font-medium">
            {searchTerm
              ? t("namespaces:enhancedToolsTable.noToolsMatch")
              : t("namespaces:enhancedToolsTable.noToolsFound")}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {searchTerm
              ? t("namespaces:enhancedToolsTable.tryAdjustingSearch")
              : t("namespaces:enhancedToolsTable.noToolsFound")}
          </p>
          {searchTerm ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchTerm("")}
              className="mt-2"
            >
              {t("namespaces:enhancedToolsTable.clearSearch")}
            </Button>
          ) : (
            onRefreshTools && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefreshTools}
                disabled={loading}
                className="mt-3"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                {t("namespaces:enhancedToolsTable.refreshTools")}
              </Button>
            )
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="min-w-[150px] w-[200px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("name")}
                    className="h-auto p-0 font-medium hover:bg-transparent"
                  >
                    {t("namespaces:enhancedToolsTable.toolName")}
                    {renderSortIcon("name")}
                  </Button>
                </TableHead>
                <TableHead className="min-w-[120px] w-[150px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("serverName")}
                    className="h-auto p-0 font-medium hover:bg-transparent"
                  >
                    {t("namespaces:enhancedToolsTable.mcpServer")}
                    {renderSortIcon("serverName")}
                  </Button>
                </TableHead>
                <TableHead className="w-[80px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("status")}
                    className="h-auto p-0 font-medium hover:bg-transparent"
                  >
                    {t("namespaces:enhancedToolsTable.status")}
                    {renderSortIcon("status")}
                  </Button>
                </TableHead>
                <TableHead className="min-w-[200px] max-w-[300px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("description")}
                    className="h-auto p-0 font-medium hover:bg-transparent"
                  >
                    {t("namespaces:enhancedToolsTable.description")}
                    {renderSortIcon("description")}
                  </Button>
                </TableHead>
                <TableHead className="w-[100px]">
                  {t("namespaces:enhancedToolsTable.source")}
                </TableHead>
                <TableHead className="w-[130px]">
                  <Button
                    variant="ghost"
                    onClick={() => handleSort("updated_at")}
                    className="h-auto p-0 font-medium hover:bg-transparent"
                  >
                    {t("namespaces:enhancedToolsTable.updatedAt")}
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
                const isToggling = updateToolStatusMutation.isPending;

                return (
                  <React.Fragment key={toolId}>
                    {/* Main row */}
                    <TableRow className="group">
                      <TableCell className="w-[40px]">
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
                      <TableCell className="font-medium min-w-[150px] w-[200px]">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-4 w-4 text-blue-500 flex-shrink-0" />
                          <span className="truncate">{tool.name}</span>
                          {tool.isTemporary && (
                            <Badge
                              variant="warning"
                              className="text-xs flex-shrink-0"
                            >
                              {t("namespaces:enhancedToolsTable.badges.new")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[120px] w-[150px]">
                        {tool.serverName && tool.serverUuid ? (
                          <Link
                            href={`/mcp-servers/${tool.serverUuid}`}
                            className="flex items-center gap-2 hover:underline"
                          >
                            <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium truncate">
                              {tool.serverName}
                            </span>
                          </Link>
                        ) : tool.serverName ? (
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium truncate">
                              {tool.serverName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">
                            {t("namespaces:enhancedToolsTable.unknownServer")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="w-[80px]">
                        {tool.sources.saved ? (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={tool.status === "ACTIVE"}
                              onCheckedChange={() => handleStatusToggle(tool)}
                              disabled={isToggling}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            {t("namespaces:enhancedToolsTable.notSaved")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[200px] max-w-[300px]">
                        <div className="w-full">
                          {tool.description ? (
                            <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                              {tool.description}
                            </p>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">
                              {t("namespaces:enhancedToolsTable.noDescription")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="w-[100px]">
                        {getSourceBadge(tool)}
                      </TableCell>
                      <TableCell className="w-[130px]">
                        {tool.updated_at ? (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs text-muted-foreground truncate">
                              {formatDate(tool.updated_at)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            {t("namespaces:enhancedToolsTable.notSaved")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="w-[40px]">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => toggleRowExpansion(toolId)}
                            >
                              {isExpanded ? (
                                <>
                                  <EyeOff className="mr-2 h-4 w-4" />
                                  {t(
                                    "namespaces:enhancedToolsTable.hideDetails",
                                  )}
                                </>
                              ) : (
                                <>
                                  <Eye className="mr-2 h-4 w-4" />
                                  {t(
                                    "namespaces:enhancedToolsTable.showDetails",
                                  )}
                                </>
                              )}
                            </DropdownMenuItem>
                            {tool.serverUuid && (
                              <DropdownMenuItem asChild>
                                <Link href={`/mcp-servers/${tool.serverUuid}`}>
                                  <Server className="mr-2 h-4 w-4" />
                                  {t(
                                    "namespaces:enhancedToolsTable.viewServer",
                                  )}
                                </Link>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {/* Expanded details row */}
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/50">
                          <div className="py-4 space-y-4">
                            {/* Tool Info */}
                            <div className="flex items-center gap-4">
                              {tool.uuid && (
                                <div className="flex items-center gap-2">
                                  <Hash className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm font-medium">
                                    {t(
                                      "namespaces:enhancedToolsTable.toolInfo.uuid",
                                    )}
                                    :
                                  </span>
                                  <code className="text-sm bg-background px-2 py-1 rounded border">
                                    {tool.uuid}
                                  </code>
                                </div>
                              )}
                              {tool.serverName && (
                                <div className="flex items-center gap-2">
                                  <Server className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm font-medium">
                                    {t(
                                      "namespaces:enhancedToolsTable.toolInfo.server",
                                    )}
                                    :
                                  </span>
                                  {tool.serverUuid ? (
                                    <Link
                                      href={`/mcp-servers/${tool.serverUuid}`}
                                      className="text-sm text-blue-600 hover:underline"
                                    >
                                      {tool.serverName}
                                    </Link>
                                  ) : (
                                    <span className="text-sm">
                                      {tool.serverName}
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {t(
                                    "namespaces:enhancedToolsTable.toolInfo.source",
                                  )}
                                  :
                                </span>
                                {getSourceBadge(tool)}
                              </div>
                              {tool.status && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">
                                    {t(
                                      "namespaces:enhancedToolsTable.toolInfo.status",
                                    )}
                                    :
                                  </span>
                                  <span
                                    className={`text-xs font-medium ${
                                      tool.status === "ACTIVE"
                                        ? "text-green-600"
                                        : "text-gray-500"
                                    }`}
                                  >
                                    {tool.status === "ACTIVE"
                                      ? t(
                                          "namespaces:enhancedToolsTable.active",
                                        )
                                      : t(
                                          "namespaces:enhancedToolsTable.inactive",
                                        )}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Tool Description */}
                            {tool.description && (
                              <div>
                                <h5 className="text-sm font-medium mb-2">
                                  {t(
                                    "namespaces:enhancedToolsTable.toolDescription",
                                  )}
                                </h5>
                                <div className="bg-background p-3 rounded border">
                                  <p className="text-sm text-muted-foreground">
                                    {tool.description}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Tool Schema */}
                            <div>
                              <h5 className="text-sm font-medium mb-2">
                                {t("namespaces:enhancedToolsTable.toolSchema")}
                              </h5>
                              <div className="bg-background p-3 rounded border">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-medium">
                                    {t("namespaces:enhancedToolsTable.type")}:
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
                                      {t(
                                        "namespaces:enhancedToolsTable.parameters",
                                      )}
                                      :
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
                                              <span className="text-red-500 text-xs font-bold">
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
                                {t(
                                  "namespaces:enhancedToolsTable.showFullSchemaJson",
                                )}
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
        </div>
      )}
    </div>
  );
}
