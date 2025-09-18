"use client";

import {
  McpServer,
  McpServerErrorStatusEnum,
  McpServerTypeEnum,
} from "@repo/zod-types";
import { ArrowLeft, Edit, Eye, EyeOff, Plug, Server } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

import { EditMcpServer } from "@/components/edit-mcp-server";
import { ServerDetailsSkeleton } from "@/components/skeletons/server-details-skeleton";
import { ToolManagementSkeleton } from "@/components/skeletons/tool-management-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnection } from "@/hooks/useConnection";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

import { ToolManagement } from "./components/tool-management";

interface McpServerDetailPageProps {
  params: Promise<{
    uuid: string;
  }>;
}

export default function McpServerDetailPage({
  params,
}: McpServerDetailPageProps) {
  const { uuid } = use(params);
  const router = useRouter();
  const { t } = useTranslations();

  // State to track which sensitive fields are revealed
  const [revealedEnvVars, setRevealedEnvVars] = useState<Set<string>>(
    new Set(),
  );
  const [bearerTokenRevealed, setBearerTokenRevealed] =
    useState<boolean>(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);
  const [editDialogOpen, setEditDialogOpen] = useState<boolean>(false);

  // Function to toggle env var visibility
  const toggleEnvVarVisibility = (key: string) => {
    setRevealedEnvVars((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Function to mask sensitive values
  const maskSensitiveValue = (value: string) => {
    return "•".repeat(Math.min(value.length, 12));
  };

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Use tRPC query for data fetching
  const {
    data: serverResponse,
    error,
    isLoading,
    refetch,
  } = trpc.frontend.mcpServers.get.useQuery({ uuid });

  // tRPC mutation for deleting server
  const deleteMutation = trpc.frontend.mcpServers.delete.useMutation({
    onSuccess: (result) => {
      // Check if the operation was actually successful
      if (result.success) {
        // Invalidate the list cache since server was deleted
        utils.frontend.mcpServers.list.invalidate();
        toast.success(t("mcp-servers:detail.deleteServerSuccess"));
        // Navigate back to the servers list
        router.push("/mcp-servers");
      } else {
        // Handle business logic failures
        console.error("Delete failed:", result.message);
        toast.error(t("mcp-servers:detail.deleteServerError"), {
          description:
            result.message || t("mcp-servers:detail.deleteServerError"),
        });
        setShowDeleteDialog(false);
      }
    },
    onError: (error) => {
      console.error("Error deleting server:", error);
      toast.error(t("mcp-servers:detail.deleteServerError"), {
        description: error.message,
      });
      setShowDeleteDialog(false);
    },
  });

  const server: McpServer | undefined = serverResponse?.success
    ? serverResponse.data
    : undefined;

  // MCP Connection setup - only enable when server data is loaded and not in error state
  const connection = useConnection({
    mcpServerUuid: uuid,
    transportType: server?.type || McpServerTypeEnum.Enum.STDIO,
    command: server?.command || "",
    args: server?.args?.join(" ") || "",
    url: server?.url || "",
    env: server?.env || {},
    bearerToken: server?.bearerToken || undefined,
    onNotification: (notification) => {
      console.log("MCP Notification:", notification);
    },
    onStdErrNotification: (notification) => {
      console.error("MCP StdErr:", notification);
    },
    enabled: Boolean(
      server &&
        !isLoading &&
        server.error_status !== McpServerErrorStatusEnum.Enum.ERROR,
    ),
  });

  // Auto-connect when hook is enabled and not already connected
  useEffect(() => {
    if (
      connection &&
      server &&
      !isLoading &&
      server.error_status !== McpServerErrorStatusEnum.Enum.ERROR &&
      connection.connectionStatus === "disconnected"
    ) {
      connection.connect();
    }
  }, [server, connection, isLoading]);

  // Handle delete server
  const handleDeleteServer = async () => {
    deleteMutation.mutate({ uuid });
  };

  // Handle successful edit
  const handleEditSuccess = () => {
    // Invalidate cache to get fresh data (already handled by EditMcpServer component)
    setEditDialogOpen(false);
    // Toast is handled by the EditMcpServer component
  };

  // Handle manual connect/disconnect
  const handleConnectionToggle = () => {
    if (server?.error_status === McpServerErrorStatusEnum.Enum.ERROR) {
      // Don't allow connection if server is in error state
      return;
    }
    if (connection.connectionStatus === "connected") {
      connection.disconnect();
    } else {
      connection.connect();
    }
  };

  // Get connection status display info
  const getConnectionStatusInfo = () => {
    // If server is in error state, show error status
    if (server?.error_status === McpServerErrorStatusEnum.Enum.ERROR) {
      return {
        text: t("mcp-servers:detail.serverError"),
        color: "text-destructive",
        icon: Server,
      };
    }

    switch (connection.connectionStatus) {
      case "connected":
        return {
          text: t("mcp-servers:connected"),
          color: "text-green-600 dark:text-green-400",
          icon: Plug,
        };
      case "disconnected":
        return {
          text: t("mcp-servers:disconnected"),
          color: "text-muted-foreground",
          icon: Server,
        };
      case "error":
      case "error-connecting-to-proxy":
        return {
          text: t("mcp-servers:detail.connectionError"),
          color: "text-destructive",
          icon: Server,
        };
      default:
        return {
          text: t("mcp-servers:detail.connecting"),
          color: "text-yellow-600 dark:text-yellow-400",
          icon: Plug,
        };
    }
  };

  if (error) {
    const isNotFound =
      error.message.includes("not found") || error.message.includes("404");
    if (isNotFound) {
      notFound();
    }
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/mcp-servers">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("mcp-servers:detail.backToServers")}
            </Button>
          </Link>
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <div className="flex flex-col items-center justify-center mx-auto max-w-md">
            <Server className="size-12 text-red-400" />
            <h3 className="mt-4 text-lg font-semibold">
              {t("mcp-servers:detail.errorLoadingTitle")}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {error.message || t("mcp-servers:detail.errorLoadingDescription")}
            </p>
            <Button
              onClick={() => refetch()}
              className="mt-4"
              variant="outline"
            >
              {t("mcp-servers:detail.retry")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/mcp-servers">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("mcp-servers:detail.backToServers")}
            </Button>
          </Link>
        </div>

        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
            <div className="flex items-center space-x-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </div>

        {/* Server Details Skeleton */}
        <ServerDetailsSkeleton />

        {/* Tools Management Skeleton */}
        <div className="rounded-lg border p-6">
          <Skeleton className="h-6 w-32 mb-4" />
          <ToolManagementSkeleton />
        </div>
      </div>
    );
  }

  if (!server) {
    notFound();
  }

  const connectionInfo = getConnectionStatusInfo();
  const ConnectionIcon = connectionInfo.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/mcp-servers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("mcp-servers:detail.backToServers")}
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
          >
            <Edit className="h-4 w-4 mr-2" />
            {t("mcp-servers:detail.editServer")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            {t("mcp-servers:detail.deleteServer")}
          </Button>
        </div>
      </div>

      {/* Edit Server Dialog */}
      <EditMcpServer
        server={server}
        isOpen={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        onSuccess={handleEditSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("mcp-servers:detail.deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("mcp-servers:detail.deleteConfirmDescription", {
                name: server?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteMutation.isPending}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteServer}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? t("mcp-servers:detail.deleting")
                : t("mcp-servers:detail.deleteServer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Server Info */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight truncate">
              {server.name}
            </h1>
            {server.description && (
              <p
                className="text-muted-foreground mt-1 text-sm lg:text-base overflow-hidden"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {server.description}
              </p>
            )}
          </div>
          <div className="flex-shrink-0">
            {/* MCP Connection Status - only show if server exists */}
            {server && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium whitespace-nowrap">
                    {t("mcp-servers:detail.mcpConnection")}:
                  </span>
                  <ConnectionIcon className="h-4 w-4 flex-shrink-0" />
                  <span
                    className={`text-sm font-medium whitespace-nowrap ${connectionInfo.color}`}
                  >
                    {connectionInfo.text}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnectionToggle}
                  disabled={connection.connectionStatus === "connecting"}
                  className="whitespace-nowrap flex-shrink-0"
                >
                  {connection.connectionStatus === "connected"
                    ? t("mcp-servers:detail.reconnect")
                    : t("mcp-servers:detail.connect")}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Server Details */}
        {server ? (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Basic Information */}
            <div className="rounded-lg border p-6">
              <h3 className="text-lg font-semibold mb-4">
                {t("mcp-servers:detail.basicInformation")}
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("mcp-servers:detail.uuid")}:
                  </span>
                  <p className="text-sm font-mono text-right flex-1 ml-6">
                    {server.uuid}
                  </p>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("mcp-servers:detail.type")}:
                  </span>
                  <div className="flex-1 ml-6 flex justify-end">
                    <Badge variant="info">{server.type.toUpperCase()}</Badge>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("mcp-servers:detail.created")}:
                  </span>
                  <p className="text-sm text-right flex-1 ml-6">
                    {new Date(server.created_at).toLocaleDateString()}{" "}
                    {new Date(server.created_at).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("mcp-servers:detail.errorStatus")}:
                  </span>
                  <div className="flex-1 ml-6 flex justify-end">
                    <Badge
                      variant={
                        server.error_status ===
                        McpServerErrorStatusEnum.Enum.ERROR
                          ? "destructive"
                          : "success"
                      }
                    >
                      {server.error_status ===
                      McpServerErrorStatusEnum.Enum.ERROR
                        ? t("mcp-servers:detail.error")
                        : t("mcp-servers:detail.noError")}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Configuration */}
            <div className="rounded-lg border p-6">
              <h3 className="text-lg font-semibold mb-4">
                {t("mcp-servers:detail.configuration")}
              </h3>
              <div className="space-y-4">
                {server.command && (
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {t("mcp-servers:detail.command")}:
                    </span>
                    <p className="text-sm font-mono bg-muted p-2 rounded break-all">
                      {server.command}
                    </p>
                  </div>
                )}
                {server.args.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {t("mcp-servers:detail.arguments")}:
                    </span>
                    <p className="text-sm font-mono bg-muted p-2 rounded break-all">
                      {server.args.join(" ")}
                    </p>
                  </div>
                )}
                {server.url && (
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {t("mcp-servers:detail.url")}:
                    </span>
                    <p className="text-sm font-mono bg-muted p-2 rounded break-all">
                      {server.url}
                    </p>
                  </div>
                )}
                {server.bearerToken && (
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {t("mcp-servers:detail.authBearerToken")}:
                    </span>
                    <div className="flex items-start gap-2 bg-muted p-2 rounded">
                      <span className="text-sm font-mono text-muted-foreground flex-1 break-all">
                        {bearerTokenRevealed
                          ? server.bearerToken
                          : maskSensitiveValue(server.bearerToken)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 flex-shrink-0"
                        onClick={() =>
                          setBearerTokenRevealed(!bearerTokenRevealed)
                        }
                        title={
                          bearerTokenRevealed
                            ? t("mcp-servers:detail.hideToken")
                            : t("mcp-servers:detail.showToken")
                        }
                      >
                        {bearerTokenRevealed ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Environment Variables */}
            {Object.keys(server.env).length > 0 && (
              <div className="rounded-lg border p-6 md:col-span-2">
                <h3 className="text-lg font-semibold mb-4">
                  {t("mcp-servers:detail.environmentVariables")}
                </h3>
                <div className="space-y-3">
                  {Object.entries(server.env).map(([key, value]) => {
                    const isRevealed = revealedEnvVars.has(key);
                    const displayValue = isRevealed
                      ? value
                      : maskSensitiveValue(value);

                    return (
                      <div key={key} className="p-3 bg-muted rounded space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-mono font-medium">
                            {key}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 flex-shrink-0"
                            onClick={() => toggleEnvVarVisibility(key)}
                            title={
                              isRevealed
                                ? t("mcp-servers:detail.hideValue")
                                : t("mcp-servers:detail.showValue")
                            }
                          >
                            {isRevealed ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="text-sm font-mono text-muted-foreground break-all">
                          {displayValue}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <ServerDetailsSkeleton />
        )}

        {/* Tools Management */}
        {server && (
          <div className="rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("mcp-servers:detail.toolsManagement")}
            </h3>
            {server.error_status === McpServerErrorStatusEnum.Enum.ERROR ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <div className="flex flex-col items-center justify-center mx-auto max-w-md">
                    <Server className="size-12 text-red-400" />
                    <h4 className="mt-4 text-lg font-semibold">
                      {t("mcp-servers:detail.serverErrorTitle")}
                    </h4>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("mcp-servers:detail.serverErrorDescription")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("mcp-servers:detail.fixServerErrorToManageTools")}
                    </p>
                  </div>
                </div>
              </div>
            ) : connection.connectionStatus === "connected" ? (
              <ToolManagement
                mcpServerUuid={uuid}
                makeRequest={connection.makeRequest}
              />
            ) : (
              <div className="space-y-4">
                <ToolManagementSkeleton />
                <div className="flex justify-center">
                  <div className="text-sm text-muted-foreground">
                    {connection.connectionStatus === "connecting"
                      ? t("mcp-servers:detail.connectingToServer")
                      : t("mcp-servers:detail.connectToManageTools")}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
