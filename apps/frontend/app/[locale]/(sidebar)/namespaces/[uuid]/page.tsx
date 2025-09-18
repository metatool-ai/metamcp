"use client";

import { McpServerTypeEnum } from "@repo/zod-types";
import { ArrowLeft, Calendar, Edit, Hash, Plug, Server } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EditNamespace } from "@/components/edit-namespace";
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

import { NamespaceServersTable } from "./components/namespace-servers-table";
import { NamespaceToolManagement } from "./components/namespace-tool-management";

interface NamespaceDetailPageProps {
  params: Promise<{
    uuid: string;
  }>;
}

export default function NamespaceDetailPage({
  params,
}: NamespaceDetailPageProps) {
  const { uuid } = use(params);
  const router = useRouter();
  const { t } = useTranslations();

  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);
  const [editDialogOpen, setEditDialogOpen] = useState<boolean>(false);
  const lastToggleTimeRef = useRef<number>(0);

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Use tRPC query for data fetching
  const {
    data: namespaceResponse,
    error,
    isLoading,
    refetch,
  } = trpc.frontend.namespaces.get.useQuery({ uuid });

  // tRPC mutation for deleting namespace
  const deleteMutation = trpc.frontend.namespaces.delete.useMutation({
    onSuccess: (result) => {
      // Check if the operation was actually successful
      if (result.success) {
        // Invalidate the list cache since namespace was deleted
        utils.frontend.namespaces.list.invalidate();
        toast.success(t("namespaces:namespaceDeletedSuccess"));
        // Navigate back to the namespaces list
        router.push("/namespaces");
      } else {
        // Handle business logic failures
        console.error("Delete failed:", result.message);
        toast.error(t("namespaces:failedToDeleteNamespace"), {
          description:
            result.message ||
            t("namespaces:detail.anErrorOccurredWhileDeleting"),
        });
        setShowDeleteDialog(false);
      }
    },
    onError: (error) => {
      console.error("Error deleting namespace:", error);
      toast.error(t("namespaces:failedToDeleteNamespace"), {
        description: error.message,
      });
      setShowDeleteDialog(false);
    },
  });

  const namespace = namespaceResponse?.success
    ? namespaceResponse.data
    : undefined;

  // MetaMCP Connection setup - connect to the metamcp proxy endpoint for this namespace
  const connection = useConnection({
    mcpServerUuid: uuid, // Using namespace UUID as the "server" UUID for connection
    transportType: McpServerTypeEnum.Enum.SSE,
    command: "", // Not needed for metamcp proxy
    args: "",
    url: `/mcp-proxy/metamcp/${uuid}/sse`, // Connect to metamcp proxy endpoint
    env: {},
    bearerToken: undefined,
    isMetaMCP: true, // Indicate this is a MetaMCP connection
    includeInactiveServers: true, // Include all servers regardless of status in namespace management
    onNotification: (notification) => {
      console.log("MetaMCP Notification:", notification);
    },
    onStdErrNotification: (notification) => {
      console.error("MetaMCP StdErr:", notification);
    },
    enabled: Boolean(namespace && !isLoading),
  });

  // Auto-connect when hook is enabled and not already connected
  useEffect(() => {
    if (
      connection &&
      namespace &&
      !isLoading &&
      connection.connectionStatus === "disconnected"
    ) {
      connection.connect();
    }
  }, [namespace, connection, isLoading]);

  // Handle delete namespace
  const handleDeleteNamespace = async () => {
    deleteMutation.mutate({ uuid });
  };

  // Handle successful edit
  const handleEditSuccess = () => {
    setEditDialogOpen(false);
    // The EditNamespace component already handles cache invalidation
    // So we just need to close the dialog

    // Refresh the MetaMCP connection to pick up server changes
    handleConnectionRefresh();
  };

  // Handle manual connect/disconnect
  const handleConnectionToggle = () => {
    if (connection.connectionStatus === "connected") {
      connection.disconnect();
    } else {
      connection.connect();
    }
  };

  // Handle server status change - backend handles server pool invalidation automatically
  const handleServerStatusChange = () => {
    const now = Date.now();
    const timeSinceLastToggle = now - lastToggleTimeRef.current;

    // Prevent rapid successive toggles (minimum 2 seconds between toggles)
    if (timeSinceLastToggle < 2000) {
      toast.warning(t("namespaces:detail.toggleTooFast"), {
        description: t("namespaces:detail.toggleTooFastDescription"),
      });
      return;
    }

    lastToggleTimeRef.current = now;

    // No need to refresh connection - backend handles server pool invalidation
    // This prevents unnecessary reinitialization of all MCP servers
    console.log(
      "Server status changed - backend will handle server pool invalidation",
    );
  };

  // Handle connection refresh (disconnect and reconnect to pick up server changes)
  const handleConnectionRefresh = () => {
    if (connection.connectionStatus === "connected") {
      connection.disconnect().then(() => {
        // Small delay to ensure clean disconnect before reconnecting
        setTimeout(() => {
          connection.connect();
        }, 100);
      });
    } else {
      connection.connect();
    }
  };

  // Get connection status display info
  const getConnectionStatusInfo = () => {
    switch (connection.connectionStatus) {
      case "connected":
        return {
          text: t("namespaces:detail.connected"),
          color: "text-green-600",
          icon: Plug,
        };
      case "disconnected":
        return {
          text: t("namespaces:detail.disconnected"),
          color: "text-gray-500",
          icon: Server,
        };
      case "error":
      case "error-connecting-to-proxy":
        return {
          text: t("namespaces:detail.connectionError"),
          color: "text-red-600",
          icon: Server,
        };
      default:
        return {
          text: t("namespaces:detail.connecting"),
          color: "text-yellow-600",
          icon: Plug,
        };
    }
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

  if (error) {
    const isNotFound =
      error.message.includes("not found") || error.message.includes("404");
    if (isNotFound) {
      notFound();
    }
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/namespaces">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("namespaces:detail.backToNamespaces")}
            </Button>
          </Link>
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <div className="flex flex-col items-center justify-center mx-auto max-w-md">
            <Hash className="size-12 text-red-400" />
            <h3 className="mt-4 text-lg font-semibold">
              {t("namespaces:detail.errorLoadingNamespace")}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {error.message ||
                t("namespaces:detail.failedToLoadNamespaceDetails")}
            </p>
            <Button
              onClick={() => refetch()}
              className="mt-4"
              variant="outline"
            >
              {t("namespaces:detail.retry")}
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
          <Link href="/namespaces">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("namespaces:detail.backToNamespaces")}
            </Button>
          </Link>
        </div>

        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex items-center space-x-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>

        {/* Namespace Details Skeleton */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border p-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border p-6">
            <Skeleton className="h-6 w-24 mb-4" />
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MCP Servers Table Skeleton */}
        <div className="rounded-lg border p-6">
          <Skeleton className="h-6 w-32 mb-4" />
          <div className="space-y-3">
            <div className="flex space-x-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 flex-1" />
              ))}
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex space-x-4">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 flex-1" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!namespace) {
    notFound();
  }

  const connectionInfo = getConnectionStatusInfo();
  const ConnectionIcon = connectionInfo.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/namespaces">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("namespaces:detail.backToNamespaces")}
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditDialogOpen(true)}
          >
            <Edit className="h-4 w-4 mr-2" />
            {t("namespaces:editNamespace")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            {t("namespaces:deleteNamespace")}
          </Button>
        </div>
      </div>

      {/* Edit Namespace Dialog */}
      <EditNamespace
        namespace={namespace}
        isOpen={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        onSuccess={handleEditSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("namespaces:deleteNamespace")}</DialogTitle>
            <DialogDescription>
              {t("namespaces:detail.deleteNamespaceConfirmation", {
                name: namespace?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteMutation.isPending}
            >
              {t("namespaces:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteNamespace}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? t("namespaces:deleting")
                : t("namespaces:deleteNamespace")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Namespace Info */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {namespace.name}
            </h1>
            {namespace.description && (
              <p className="text-muted-foreground mt-1">
                {namespace.description}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-4">
            {/* MetaMCP Connection Status */}
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">
                {t("namespaces:detail.metaMcpConnection")}:
              </span>
              <ConnectionIcon className="h-4 w-4" />
              <span className={`text-sm font-medium ${connectionInfo.color}`}>
                {connectionInfo.text}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnectionToggle}
                disabled={connection.connectionStatus === "connecting"}
              >
                {connection.connectionStatus === "connected"
                  ? t("namespaces:detail.reconnect")
                  : t("namespaces:detail.connect")}
              </Button>
            </div>
          </div>
        </div>

        {/* Section 1: Basic Overview */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Information */}
          <div className="rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("namespaces:detail.basicInformation")}
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:detail.uuid")}:
                </span>
                <p className="text-sm font-mono text-right flex-1 ml-6">
                  {namespace.uuid}
                </p>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:name")}:
                </span>
                <p className="text-sm font-medium text-right flex-1 ml-6">
                  {namespace.name}
                </p>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:descriptionLabel")}:
                </span>
                <p className="text-sm text-right flex-1 ml-6">
                  {namespace.description || t("namespaces:noDescription")}
                </p>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:created")}:
                </span>
                <div className="flex items-center gap-2 flex-1 ml-6 justify-end">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <p className="text-sm">{formatDate(namespace.created_at)}</p>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:detail.lastUpdated")}:
                </span>
                <div className="flex items-center gap-2 flex-1 ml-6 justify-end">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <p className="text-sm">{formatDate(namespace.updated_at)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Statistics */}
          <div className="rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("namespaces:detail.statistics")}
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:detail.mcpServers")}:
                </span>
                <div className="flex-1 ml-6 flex justify-end">
                  <Badge variant="info">
                    {namespace.servers.length}{" "}
                    {namespace.servers.length === 1
                      ? t("namespaces:detail.server")
                      : t("namespaces:detail.servers")}
                  </Badge>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:detail.activeServers")}:
                </span>
                <div className="flex-1 ml-6 flex justify-end">
                  <Badge variant="success">
                    {
                      namespace.servers.filter((s) => s.status === "ACTIVE")
                        .length
                    }{" "}
                    {t("namespaces:detail.active")}
                  </Badge>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("namespaces:detail.serverTypes")}:
                </span>
                <div className="flex-1 ml-6 flex justify-end">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {Array.from(
                      new Set(namespace.servers.map((s) => s.type)),
                    ).map((type) => (
                      <Badge key={type} variant="neutral">
                        {type}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: MCP Servers Data Table */}
        <div className="rounded-lg border p-6">
          <h3 className="text-lg font-semibold mb-4">
            {t("namespaces:detail.mcpServers")}
          </h3>
          <NamespaceServersTable
            servers={namespace.servers}
            namespaceUuid={namespace.uuid}
            onServerStatusChange={handleServerStatusChange}
          />
        </div>

        {/* Section 3: Tools Management */}
        <div className="rounded-lg border p-6">
          <h3 className="text-lg font-semibold mb-4">
            {t("namespaces:detail.toolsManagement")}
          </h3>
          {connection.connectionStatus === "connected" ? (
            <NamespaceToolManagement
              servers={namespace.servers}
              namespaceUuid={namespace.uuid}
              makeRequest={connection.makeRequest}
            />
          ) : (
            <div className="space-y-4">
              <NamespaceToolManagement
                servers={namespace.servers}
                namespaceUuid={namespace.uuid}
              />
              <div className="flex justify-center">
                <div className="text-sm text-muted-foreground">
                  {connection.connectionStatus === "connecting"
                    ? t("namespaces:detail.connectingToMetaMcp")
                    : t("namespaces:detail.connectToMetaMcpToEnable")}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
