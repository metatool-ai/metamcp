"use client";

import {
  ClientRequest,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolStatusEnum } from "@repo/zod-types";
import { AlertTriangle, Database, RefreshCw, Wrench } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ToolManagementSkeleton } from "@/components/skeletons/tool-management-skeleton";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

import { EnhancedNamespaceToolsTable } from "./enhanced-namespace-tools-table";

interface NamespaceToolManagementProps {
  servers: Array<{
    uuid: string;
    name: string;
    status: string;
  }>;
  namespaceUuid: string;
  makeRequest?: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: { suppressToast?: boolean },
  ) => Promise<z.output<T>>; // Optional makeRequest function for MetaMCP connections
  sessionInitializing?: boolean; // Whether session initialization is in progress
}

export function NamespaceToolManagement({
  servers,
  namespaceUuid,
  makeRequest,
  sessionInitializing = false,
}: NamespaceToolManagementProps) {
  const [loading, setLoading] = useState(false);
  const [mcpTools, setMcpTools] = useState<
    Array<{
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }>
  >([]);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const hasAttemptedInitialFetch = useRef(false);

  // Get translations
  const { t } = useTranslations();

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Get tools from namespace tool mapping table
  const {
    data: toolsResponse,
    isLoading: isToolsLoading,
    refetch: refetchTools,
  } = trpc.frontend.namespaces.getTools.useQuery({
    namespaceUuid,
  });

  const namespaceTools = toolsResponse?.success ? toolsResponse.data : [];

  // Track if this is an auto-save operation (only for first load)
  // const [isAutoSaving, setIsAutoSaving] = useState(false);

  // Refresh tools mutation (used only for auto-save on first load)
  const refreshToolsMutation =
    trpc.frontend.namespaces.refreshTools.useMutation({
      onSuccess: (response) => {
        if (response.success) {
          // Always show the backend response message which contains useful details
          const toastTitle = isAutoSaving
            ? t("namespaces:toolManagement.toolsAutoSaved")
            : t("namespaces:toolManagement.toolsRefreshed");

          toast.success(toastTitle, {
            description: response.message, // Backend provides the detailed message
          });

          if (isAutoSaving) {
            setIsAutoSaving(false);
          }

          // Invalidate the namespace tools query to refresh the data
          utils.frontend.namespaces.getTools.invalidate({ namespaceUuid });
        } else {
          toast.error(t("namespaces:toolManagement.toolsRefreshFailed"), {
            description: response.message,
          });
          if (isAutoSaving) {
            setIsAutoSaving(false);
          }
        }
      },
      onError: (error) => {
        console.error("Error refreshing tools:", error);
        toast.error(t("namespaces:toolManagement.toolsRefreshFailed"), {
          description: error.message,
        });
        if (isAutoSaving) {
          setIsAutoSaving(false);
        }
      },
    });

  // Fetch tools from MetaMCP
  const fetchMetaMCPTools = useCallback(
    async (autoSave: boolean = false) => {
      if (!makeRequest) {
        console.warn("MetaMCP connection not available");
        return;
      }

      try {
        const listToolsRequest: ClientRequest = {
          method: "tools/list",
          params: {},
        };

        const toolsListResponse = await makeRequest(
          listToolsRequest,
          ListToolsResultSchema,
          { suppressToast: true },
        );

        if (toolsListResponse && toolsListResponse.tools) {
          const mcpToolsData = toolsListResponse.tools.map((tool) => ({
            name: tool.name,
            description: tool.description || "",
            inputSchema: tool.inputSchema,
          }));

          setMcpTools(mcpToolsData);

          // Automatically save tools to namespace mappings when autoSave is true (first load only)
          if (autoSave && toolsListResponse.tools.length > 0) {
            const toolsForSubmission = toolsListResponse.tools.map((tool) => ({
              name: tool.name, // Keep the full "ServerName__toolName" format
              description: tool.description || "",
              inputSchema: tool.inputSchema,
            }));

            // Set auto-saving flag for better user feedback
            setIsAutoSaving(true);

            // Submit the tools for update to namespace tool mapping records
            refreshToolsMutation.mutate({
              namespaceUuid,
              tools: toolsForSubmission,
            });
          } else if (autoSave) {
            // Auto-save requested but no tools found - this is fine
          } else {
            // Manual refresh - not auto-saving
          }
        } else {
          setMcpTools([]);
        }
      } catch (error) {
        console.error("Error fetching tools from MetaMCP:", error);
        setMcpTools([]);
      }
    },
    [makeRequest, refreshToolsMutation, namespaceUuid],
  );

  // Safely auto-fetch MetaMCP tools when connection becomes available
  React.useEffect(() => {
    if (makeRequest && !hasAttemptedInitialFetch.current) {
      hasAttemptedInitialFetch.current = true;
      // Auto-save tools on first fetch to create namespace mappings automatically
      fetchMetaMCPTools(true);
    }
  }, [makeRequest, fetchMetaMCPTools]);

  // Handle MCP refresh for all servers (just refresh display, don't save again)
  const handleRefreshAllTools = async () => {
    if (!makeRequest) {
      console.warn(t("namespaces:toolManagement.metaMCPNotAvailable"));
      setLoading(true);
      try {
        await refetchTools();
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      // Just fetch and display the tools (no mutation call to avoid duplicate toast)
      await fetchMetaMCPTools(false);

      // Show simple success message for manual refresh
      toast.success(t("namespaces:toolManagement.toolsRefreshed"), {
        description: t("namespaces:toolManagement.toolsRefreshedDescription"),
      });
    } catch (error) {
      console.error("Error fetching tools from MetaMCP:", error);
      toast.error(t("namespaces:toolManagement.fetchToolsError"), {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  // Calculate counts
  const serverCount = servers.length;
  const activeServerCount = servers.filter(
    (s) => s.status === ToolStatusEnum.Enum.ACTIVE,
  ).length;
  const savedToolCount = namespaceTools.length;
  const activeToolCount = namespaceTools.filter(
    (t) => t.status === ToolStatusEnum.Enum.ACTIVE,
  ).length;
  const mcpToolCount = mcpTools.length;

  // Calculate new tools count by comparing MetaMCP tools with saved tools
  // Parse the server__toolName format to get the actual tool name for comparison
  const newToolsCount = mcpTools.filter((mcpTool) => {
    const lastDoubleUnderscoreIndex = mcpTool.name.lastIndexOf("__");
    if (lastDoubleUnderscoreIndex === -1) return false;

    const serverName = mcpTool.name.substring(0, lastDoubleUnderscoreIndex);
    let actualToolName = mcpTool.name.substring(lastDoubleUnderscoreIndex + 2);

    // Handle nested MetaMCP scenarios - get actual server names from saved tools
    const actualServerNames = new Set(
      namespaceTools.map((tool) => tool.serverName),
    );

    if (!actualServerNames.has(serverName) && serverName.includes("__")) {
      const firstDoubleUnderscoreIndex = serverName.indexOf("__");
      const actualServerName = serverName.substring(
        0,
        firstDoubleUnderscoreIndex,
      );

      if (actualServerNames.has(actualServerName)) {
        // This is a nested MetaMCP tool - adjust parsing
        const nestedPart = serverName.substring(firstDoubleUnderscoreIndex + 2);
        actualToolName = `${nestedPart}__${actualToolName}`;
      }
    }

    return !namespaceTools.some(
      (savedTool) => savedTool.name === actualToolName,
    );
  }).length;

  // Show loading skeleton when initially loading
  if (isToolsLoading || loading) {
    return (
      <div className="space-y-4">
        {/* Header with counts and actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t("namespaces:toolManagement.toolsOverview")}
            </span>
            <span className="text-sm text-muted-foreground">
              {serverCount} {t("namespaces:toolManagement.servers")}
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="text-sm text-muted-foreground">
              {activeServerCount} {t("namespaces:toolManagement.active")}
            </span>
            <span className="text-muted-foreground">•</span>
            <Wrench className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-muted-foreground">
              {mcpToolCount} {t("namespaces:toolManagement.fromMetaMCP")}
            </span>
            <span className="text-muted-foreground">•</span>
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {savedToolCount} {t("namespaces:toolManagement.saved")}
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="text-sm text-muted-foreground">
              {activeToolCount} {t("namespaces:toolManagement.active")}
            </span>
            {newToolsCount > 0 && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-sm text-amber-600 font-medium">
                  {newToolsCount} {t("namespaces:toolManagement.new")}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAllTools}
              disabled={true}
            >
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              {sessionInitializing
                ? t("namespaces:toolManagement.initializing")
                : t("namespaces:toolManagement.refreshTools")}
            </Button>
          </div>
        </div>

        {/* Loading skeleton */}
        <div className="rounded-lg border">
          <ToolManagementSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with counts and actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t("namespaces:toolManagement.toolsOverview")}
          </span>
          <span className="text-sm text-muted-foreground">
            {serverCount} {t("namespaces:toolManagement.servers")}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-sm text-muted-foreground">
            {activeServerCount} {t("namespaces:toolManagement.active")}
          </span>
          <span className="text-muted-foreground">•</span>
          <Wrench className="h-4 w-4 text-blue-500" />
          <span className="text-sm text-muted-foreground">
            {mcpToolCount} {t("namespaces:toolManagement.fromMetaMCP")}
          </span>
          <span className="text-muted-foreground">•</span>
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {savedToolCount} {t("namespaces:toolManagement.saved")}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-sm text-muted-foreground">
            {activeToolCount} {t("namespaces:toolManagement.active")}
          </span>
          {newToolsCount > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-sm text-amber-600 font-medium">
                {newToolsCount} {t("namespaces:toolManagement.new")}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
                      <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAllTools}
              disabled={loading || isToolsLoading || sessionInitializing}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loading || isToolsLoading || sessionInitializing ? "animate-spin" : ""}`}
              />
              {sessionInitializing
                ? t("namespaces:toolManagement.initializing")
                : t("namespaces:toolManagement.refreshTools")}
            </Button>
        </div>
      </div>

      {/* Show table when tools are available, or single empty state when no tools */}
      {savedToolCount > 0 || mcpToolCount > 0 ? (
        <div className="rounded-lg border">
          <EnhancedNamespaceToolsTable
            savedTools={namespaceTools}
            mcpTools={mcpTools}
            loading={false} // We handle loading state above
            autoSaving={isAutoSaving}
            onRefreshTools={handleRefreshAllTools}
            namespaceUuid={namespaceUuid}
            servers={servers}
            sessionInitializing={sessionInitializing}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <h4 className="text-sm font-medium">
            {t("namespaces:toolManagement.noToolsAvailable")}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {t("namespaces:toolManagement.noToolsDescription")}
          </p>
        </div>
      )}
    </div>
  );
}
