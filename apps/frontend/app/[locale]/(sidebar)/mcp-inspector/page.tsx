"use client";

import { McpServer } from "@repo/zod-types";
import { ChevronDown, Edit, SearchCode, Server } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useMemo, useState } from "react";

import { EditMcpServer } from "@/components/edit-mcp-server";
import { InspectorSkeleton } from "@/components/skeletons/inspector-skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useConnection } from "@/hooks/useConnection";
import { useTranslations } from "@/hooks/useTranslations";
import { Notification } from "@/lib/notificationTypes";
import { trpc } from "@/lib/trpc";

import { Inspector } from "./components/inspector";
import { NotificationsPanel } from "./components/notifications-panel";

interface NotificationEntry {
  id: string;
  notification: Notification;
  timestamp: Date;
  type: "notification" | "stderr";
}

function McpInspectorContent() {
  const { t } = useTranslations();
  const [selectedServerUuid, setSelectedServerUuid] = useState<string>("");
  const [editDialogOpen, setEditDialogOpen] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Fetch MCP servers list
  const { data: serversResponse, isLoading: serversLoading } =
    trpc.frontend.mcpServers.list.useQuery();

  // Memoize servers array to prevent unnecessary re-renders
  const servers: McpServer[] = useMemo(() => {
    return serversResponse?.success ? serversResponse.data : [];
  }, [serversResponse]);

  // Auto-select server from URL parameter when servers are loaded
  React.useEffect(() => {
    const serverFromUrl = searchParams.get("server");
    if (serverFromUrl && servers.length > 0 && !selectedServerUuid) {
      // Check if the server UUID exists in the servers list
      const serverExists = servers.find(
        (server) => server.uuid === serverFromUrl,
      );
      if (serverExists) {
        setSelectedServerUuid(serverFromUrl);
      }
    }
  }, [servers, searchParams, selectedServerUuid]);

  // Get selected server details
  const selectedServer = servers.find(
    (server) => server.uuid === selectedServerUuid,
  );

  // Notification management functions
  const addNotification = (
    notification: Notification,
    type: "notification" | "stderr",
  ) => {
    const entry: NotificationEntry = {
      id: `${Date.now()}-${Math.random()}`,
      notification,
      timestamp: new Date(),
      type,
    };
    setNotifications((prev) => [entry, ...prev]);
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const removeNotification = (id: string) => {
    setNotifications((prev) =>
      prev.filter((notification) => notification.id !== id),
    );
  };

  // MCP Connection setup - only create connection if server exists
  const connection = useConnection({
    mcpServerUuid: selectedServerUuid,
    command: selectedServer?.command || "",
    args: selectedServer?.args?.join(" ") || "",
    sseUrl: selectedServer?.url || "",
    env: selectedServer?.env || {},
    bearerToken: selectedServer?.bearerToken || undefined,
    onNotification: (notification) => {
      addNotification(notification, "notification");
    },
    onStdErrNotification: (notification) => {
      addNotification(notification, "stderr");
    },
  });

  // Auto-connect when server is selected and not already connected
  React.useEffect(() => {
    if (
      connection &&
      selectedServer &&
      connection.connectionStatus === "disconnected"
    ) {
      connection.connect();
    }
  }, [selectedServer, connection]);

  // Auto-reconnect when switching to a different server
  React.useEffect(() => {
    if (
      connection &&
      selectedServer &&
      connection.connectionStatus === "connected"
    ) {
      // If we're connected but to a different server, reconnect
      connection.disconnect();
      // The auto-connect effect above will handle reconnecting
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerUuid, selectedServer]); // Only depend on selectedServerUuid to detect server changes

  // Clear notifications when switching servers
  React.useEffect(() => {
    clearNotifications();
  }, [selectedServerUuid]);

  const handleConnectionToggle = () => {
    if (connection.connectionStatus === "connected") {
      connection.disconnect();
    } else {
      connection.connect();
    }
  };

  // Handle successful edit
  const handleEditSuccess = () => {
    setEditDialogOpen(false);
  };

  // Get connection status display info
  const getConnectionStatusInfo = () => {
    switch (connection.connectionStatus) {
      case "connected":
        return { text: t("inspector:connected"), color: "text-green-600" };
      case "disconnected":
        return { text: t("inspector:disconnected"), color: "text-gray-500" };
      case "error":
      case "error-connecting-to-proxy":
        return { text: t("inspector:connectionError"), color: "text-red-600" };
      default:
        return { text: t("inspector:connecting"), color: "text-yellow-600" };
    }
  };

  const connectionInfo = getConnectionStatusInfo();

  // Function to handle server selection and update URL
  const handleServerSelect = (serverUuid: string) => {
    setSelectedServerUuid(serverUuid);
    // Update URL parameter
    const params = new URLSearchParams(searchParams.toString());
    if (serverUuid) {
      params.set("server", serverUuid);
    } else {
      params.delete("server");
    }
    router.replace(`/mcp-inspector?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <SearchCode className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("inspector:title")}
            </h1>
            <p className="text-muted-foreground">{t("inspector:subtitle")}</p>
          </div>
        </div>

        <Separator />

        {/* MCP Server Selection */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">
            {t("inspector:serverSelection")}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="justify-between min-w-[300px]"
              >
                <span>
                  {selectedServer
                    ? selectedServer.name
                    : t("inspector:selectServerDropdown")}
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[300px]">
              {serversLoading ? (
                <DropdownMenuItem disabled>
                  {t("inspector:loadingServers")}
                </DropdownMenuItem>
              ) : servers.length === 0 ? (
                <DropdownMenuItem disabled>
                  {t("inspector:noServersAvailable")}
                </DropdownMenuItem>
              ) : (
                servers.map((server) => (
                  <DropdownMenuItem
                    key={server.uuid}
                    onClick={() => handleServerSelect(server.uuid)}
                    className="flex flex-col items-start gap-1"
                  >
                    <div className="font-medium">{server.name}</div>
                    {server.description && (
                      <div className="text-xs text-muted-foreground">
                        {server.description}
                      </div>
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Connection Status and Controls */}
          {selectedServer && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("inspector:connectionStatus")}
              </span>
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
                  ? t("inspector:reconnectButton")
                  : t("inspector:connectButton")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditDialogOpen(true)}
              >
                <Edit className="h-4 w-4 mr-2" />
                {t("inspector:editServerButton")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Server Dialog */}
      {selectedServer && (
        <EditMcpServer
          server={selectedServer}
          isOpen={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Inspector Content */}
      <div className="rounded-lg border p-6">
        {selectedServer ? (
          connection.connectionStatus === "connected" ? (
            <Inspector
              mcpServerUuid={selectedServerUuid}
              makeRequest={connection.makeRequest}
              serverCapabilities={connection.serverCapabilities}
            />
          ) : (
            <div className="space-y-4">
              <InspectorSkeleton />
              <div className="flex justify-center">
                <div className="text-sm text-muted-foreground">
                  {connection.connectionStatus === "connecting"
                    ? t("inspector:connectingToServer")
                    : t("inspector:connectToStart")}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {t("inspector:noServerSelected")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t("inspector:noServerSelectedDesc")}
            </p>
          </div>
        )}
      </div>

      {/* Notifications Panel */}
      <NotificationsPanel
        notifications={notifications}
        onClearNotifications={clearNotifications}
        onRemoveNotification={removeNotification}
      />
    </div>
  );
}

export default function McpInspectorPage() {
  return (
    <Suspense fallback={<InspectorSkeleton />}>
      <McpInspectorContent />
    </Suspense>
  );
}
