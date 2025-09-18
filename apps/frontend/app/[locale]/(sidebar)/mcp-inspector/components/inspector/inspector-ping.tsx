"use client";

import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ClientRequest,
  EmptyResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Activity, CheckCircle, Clock, XCircle, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { useTranslations } from "@/hooks/useTranslations";

interface PingHistory {
  id: string;
  timestamp: Date;
  success: boolean;
  duration: number;
  error?: string;
  method: string;
}

interface InspectorPingProps {
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ) => Promise<z.output<T>>;
}

export function InspectorPing({ makeRequest }: InspectorPingProps) {
  const { t } = useTranslations();
  const [pinging, setPinging] = useState(false);
  const [pingHistory, setPingHistory] = useState<PingHistory[]>([]);
  const [currentPing, setCurrentPing] = useState<PingHistory | null>(null);

  const handlePing = async () => {
    setPinging(true);
    const startTime = Date.now();
    const pingId = `ping-${Date.now()}`;

    const newPing: PingHistory = {
      id: pingId,
      timestamp: new Date(),
      success: false,
      duration: 0,
      method: "ping",
    };

    setCurrentPing(newPing);

    try {
      // First try the standard ping method
      await makeRequest(
        {
          method: "ping" as const,
          params: {},
        },
        EmptyResultSchema,
        { suppressToast: true, timeout: 5000 },
      );

      const duration = Date.now() - startTime;
      const successPing = {
        ...newPing,
        success: true,
        duration,
        method: "ping",
      };

      setCurrentPing(successPing);
      setPingHistory((prev) => [successPing, ...prev].slice(0, 10)); // Keep last 10 pings
      toast.success(
        t("inspector:pingComponent.pingSuccessMessage", { duration }),
      );
    } catch (_pingError) {
      // If ping method doesn't exist, try a fallback method
      try {
        const fallbackStartTime = Date.now();

        // Try tools/list as a fallback connectivity test
        await makeRequest(
          {
            method: "tools/list" as const,
            params: {},
          },
          z.object({ tools: z.array(z.any()) }).passthrough(),
          { suppressToast: true, timeout: 3000 },
        );

        const duration = Date.now() - fallbackStartTime;
        const successPing = {
          ...newPing,
          success: true,
          duration,
          method: t("inspector:pingComponent.fallbackMethod"),
        };

        setCurrentPing(successPing);
        setPingHistory((prev) => [successPing, ...prev].slice(0, 10));
        toast.success(
          t("inspector:pingComponent.pingFallbackMessage", { duration }),
        );
      } catch (fallbackError) {
        const duration = Date.now() - startTime;
        const failedPing = {
          ...newPing,
          success: false,
          duration,
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
          method: t("inspector:pingComponent.pingAndFallback"),
        };

        setCurrentPing(failedPing);
        setPingHistory((prev) => [failedPing, ...prev].slice(0, 10));
        toast.error(
          t("inspector:pingComponent.pingFailedMessage", { duration }),
          {
            description:
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError),
          },
        );
      }
    } finally {
      setPinging(false);
    }
  };

  const clearHistory = () => {
    setPingHistory([]);
    setCurrentPing(null);
  };

  const formatDuration = (duration: number) => {
    if (duration < 1000) {
      return `${duration}ms`;
    }
    return `${(duration / 1000).toFixed(2)}s`;
  };

  const getStatusColor = (success: boolean) => {
    return success
      ? "text-green-600 dark:text-green-400"
      : "text-red-600 dark:text-red-400";
  };

  const getStatusIcon = (success: boolean) => {
    return success ? CheckCircle : XCircle;
  };

  const getAverageResponseTime = () => {
    if (pingHistory.length === 0) return 0;
    const successfulPings = pingHistory.filter((p) => p.success);
    if (successfulPings.length === 0) return 0;
    return Math.round(
      successfulPings.reduce((sum, ping) => sum + ping.duration, 0) /
        successfulPings.length,
    );
  };

  const getSuccessRate = () => {
    if (pingHistory.length === 0) return 0;
    const successfulPings = pingHistory.filter((p) => p.success).length;
    return Math.round((successfulPings / pingHistory.length) * 100);
  };

  const getLatestPings = (count: number) => {
    return pingHistory.slice(0, count);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          <span className="text-sm font-medium">
            {t("inspector:pingComponent.title")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={clearHistory}
            disabled={pinging || pingHistory.length === 0}
          >
            {t("inspector:pingComponent.clearHistory")}
          </Button>
          <Button
            onClick={handlePing}
            disabled={pinging}
            className="flex items-center gap-2"
          >
            <Activity className={`h-4 w-4 ${pinging ? "animate-pulse" : ""}`} />
            {pinging
              ? t("inspector:pingComponent.pinging")
              : t("inspector:pingServer")}
          </Button>
        </div>
      </div>

      {/* Current Status */}
      {currentPing && (
        <div className="rounded-lg border p-4">
          <h4 className="text-sm font-semibold mb-3">
            {t("inspector:pingComponent.currentStatus")}
          </h4>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(() => {
                const StatusIcon = getStatusIcon(currentPing.success);
                return (
                  <StatusIcon
                    className={`h-6 w-6 ${getStatusColor(currentPing.success)}`}
                  />
                );
              })()}
              <div>
                <div
                  className={`text-sm font-medium ${getStatusColor(currentPing.success)}`}
                >
                  {currentPing.success
                    ? t("inspector:pingComponent.serverResponsive")
                    : t("inspector:pingComponent.serverUnreachable")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("inspector:responseTime")}:{" "}
                  {formatDuration(currentPing.duration)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("inspector:pingComponent.method")}: {currentPing.method}
                </div>
                {currentPing.error && (
                  <div className="text-xs text-red-600 mt-1">
                    {t("inspector:pingComponent.error")}: {currentPing.error}
                  </div>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {currentPing.timestamp.toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      {pingHistory.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {getSuccessRate()}%
            </div>
            <div className="text-xs text-muted-foreground">
              {t("inspector:pingComponent.successRate")}
            </div>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {getAverageResponseTime()}ms
            </div>
            <div className="text-xs text-muted-foreground">
              {t("inspector:pingComponent.avgResponse")}
            </div>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {pingHistory.length}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("inspector:pingComponent.totalPings")}
            </div>
          </div>
        </div>
      )}

      {/* Ping History */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold">
          {t("inspector:pingComponent.pingHistory")} ({pingHistory.length})
        </h4>
        {pingHistory.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {t("inspector:pingComponent.noPingHistory")}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {getLatestPings(10).map((ping) => {
              const StatusIcon = getStatusIcon(ping.success);
              return (
                <div
                  key={ping.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon
                      className={`h-4 w-4 ${getStatusColor(ping.success)}`}
                    />
                    <div>
                      <div className="text-sm">
                        <span
                          className={`font-medium ${getStatusColor(ping.success)}`}
                        >
                          {ping.success
                            ? t("inspector:pingComponent.success")
                            : t("inspector:pingComponent.failed")}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          {formatDuration(ping.duration)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ping.timestamp.toLocaleString()} • {ping.method}
                      </div>
                      {ping.error && (
                        <div className="text-xs text-red-600 mt-1">
                          {ping.error}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visual indicator */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-1 h-4 rounded ${
                          i <
                          (ping.success
                            ? Math.min(
                                5,
                                Math.max(
                                  1,
                                  5 - Math.floor(ping.duration / 200),
                                ),
                              )
                            : 0)
                            ? ping.success
                              ? "bg-green-500"
                              : "bg-red-500"
                            : "bg-gray-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-4">
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-yellow-500 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-yellow-900 dark:text-yellow-100 mb-1">
              {t("inspector:pingComponent.aboutPing")}
            </h4>
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              {t("inspector:pingComponent.aboutPingDescription")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
