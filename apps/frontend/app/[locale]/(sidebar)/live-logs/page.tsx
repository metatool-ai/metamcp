"use client";

import { FileTerminal, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/hooks/useTranslations";
import { useLogsStore } from "@/lib/stores/logs-store";
import { trpc } from "@/lib/trpc";

export default function LiveLogsPage() {
  const { t } = useTranslations();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [selectedServerUuid, setSelectedServerUuid] = useState<string | null>(
    null,
  );
  const {
    logs,
    isLoading,
    isAutoRefreshing,
    totalCount,
    lastFetch,
    fetchLogs,
    clearLogs,
    setAutoRefresh,
  } = useLogsStore();

  // Use React Query for docker servers
  const {
    data: dockerServersData,
    isLoading: isLoadingServers,
    error: serversError,
  } = trpc.frontend.logs.listDockerServers.useQuery();

  const dockerServers = dockerServersData?.success
    ? (dockerServersData.servers ?? [])
    : [];

  // Auto-select first server when servers are loaded
  useEffect(() => {
    if (
      dockerServersData?.success &&
      !selectedServerUuid &&
      (dockerServersData.servers?.length ?? 0) > 0
    ) {
      const firstServer = dockerServersData.servers?.[0];
      if (firstServer?.serverUuid) {
        setSelectedServerUuid(firstServer.serverUuid);
      }
    }
  }, [dockerServersData, selectedServerUuid]);

  // Use React Query for docker logs
  const {
    data: dockerLogsData,
    isLoading: isDockerLoading,
    refetch: refetchDockerLogs,
  } = trpc.frontend.logs.dockerLogs.useQuery(
    { serverUuid: selectedServerUuid!, tail: 500 },
    {
      enabled: !!selectedServerUuid,
    },
  );

  const dockerLogLines = dockerLogsData?.success ? dockerLogsData.lines : [];

  const handleClearLogs = async () => {
    try {
      await clearLogs();
      toast.success(t("logs:logsClearSuccess"));
      setShowClearDialog(false);
    } catch (_error) {
      toast.error(t("logs:logsClearError"));
    }
  };

  const handleRefresh = async () => {
    try {
      if (selectedServerUuid) {
        await refetchDockerLogs();
      } else {
        await fetchLogs();
      }
      toast.success(t("logs:refreshSuccess"));
    } catch (_error) {
      toast.error(t("logs:refreshError"));
    }
  };

  const handleToggleAutoRefresh = () => {
    setAutoRefresh(!isAutoRefreshing);
    if (!isAutoRefreshing) {
      toast.success(t("logs:autoRefreshEnabled"));
    } else {
      toast.info(t("logs:autoRefreshDisabled"));
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileTerminal className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">{t("logs:title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("logs:subtitle")}
              {lastFetch && (
                <span className="ml-2">
                  (
                  {t("logs:lastUpdated", {
                    timestamp: formatTimestamp(lastFetch),
                  })}
                  )
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Select
              value={selectedServerUuid ?? undefined}
              onValueChange={(v) => setSelectedServerUuid(v)}
              disabled={isLoadingServers}
            >
              <SelectTrigger className="w-[320px]">
                <SelectValue
                  placeholder={
                    isLoadingServers
                      ? t("logs:loadingLogs")
                      : serversError
                        ? t("logs:error")
                        : dockerServers.length === 0
                          ? t("logs:noLogs")
                          : t("logs:selectContainer")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {dockerServers.map((s) => (
                  <SelectItem key={s.serverUuid} value={s.serverUuid}>
                    {s.serverName} ({s.containerName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!selectedServerUuid && (
              <Badge variant="outline">
                {isLoadingServers
                  ? t("logs:loadingLogs")
                  : serversError
                    ? t("logs:error")
                    : dockerServers.length === 0
                      ? t("logs:noLogs")
                      : t("logs:totalLogs", { count: totalCount })}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleToggleAutoRefresh}>
            {isAutoRefreshing
              ? t("logs:stopAutoRefresh")
              : t("logs:startAutoRefresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("logs:refresh")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowClearDialog(true)}
            disabled={isLoading || logs.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            {t("logs:clearLogs")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>{t("logs:consoleOutput")}</span>
            {isAutoRefreshing && (
              <Badge variant="secondary" className="text-xs">
                {t("logs:live")}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-black rounded-lg p-4 font-mono text-sm max-h-[600px] overflow-y-auto">
            {selectedServerUuid ? (
              dockerLogLines.length === 0 ? (
                <div className="text-gray-400 text-center py-8">
                  {isDockerLoading
                    ? t("logs:loadingLogs")
                    : t("logs:noLogsDisplay")}
                </div>
              ) : (
                <div className="space-y-1">
                  {dockerLogLines.map((line, idx) => (
                    <div key={idx} className="text-gray-300">
                      {line}
                    </div>
                  ))}
                </div>
              )
            ) : logs.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                {isLoading ? t("logs:loadingLogs") : t("logs:noLogsDisplay")}
              </div>
            ) : (
              <div className="space-y-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-2 text-gray-300 hover:bg-gray-800 px-2 py-1 rounded"
                  >
                    <span className="text-gray-500 text-xs whitespace-nowrap">
                      {formatTimestamp(new Date(log.timestamp))}
                    </span>
                    <span className="text-blue-400 font-medium">
                      [{log.serverName}]
                    </span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedServerUuid && logs.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          {t("logs:showingLogs", { count: logs.length, total: totalCount })}
        </div>
      )}

      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("logs:clearAllLogs")}</DialogTitle>
            <DialogDescription>{t("logs:clearLogsConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDialog(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearLogs}
              disabled={isLoading}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("logs:clearLogs")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
