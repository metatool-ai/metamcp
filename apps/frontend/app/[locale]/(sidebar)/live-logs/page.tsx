"use client";

import { FileTerminal, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { useTranslations } from "@/hooks/useTranslations";
import { useLogsStore } from "@/lib/stores/logs-store";

export default function LiveLogsPage() {
  const { t } = useTranslations();
  const [showClearDialog, setShowClearDialog] = useState(false);
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
      await fetchLogs();
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

  // const getLevelColor = (level: string) => {
  //   switch (level) {
  //     case "error":
  //       return "outline"; // Changed from "destructive" to "outline"
  //     case "warn":
  //       return "secondary";
  //     case "info":
  //       return "default";
  //     default:
  //       return "outline";
  //   }
  // };

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
          <Badge variant="outline">
            {t("logs:totalLogs", { count: totalCount })}
          </Badge>
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
            {logs.length === 0 ? (
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
                    <span className="flex-1">
                      {log.message}
                      {/* Removed red error text display */}
                      {/* {log.error && (
                        <span className="text-red-400 ml-2">{log.error}</span>
                      )} */}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {logs.length > 0 && (
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
