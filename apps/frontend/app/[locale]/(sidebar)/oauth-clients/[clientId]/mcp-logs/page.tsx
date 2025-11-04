"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronDown, ChevronRight, Activity, Clock, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath, SupportedLocale } from "@/lib/i18n";

export default function McpLogsPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const locale = params.locale as SupportedLocale;
  const { t } = useTranslations();
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: logsResponse, isLoading } = trpc.frontend.oauth.getMcpServerCallLogs.useQuery({
    clientId,
    limit: pageSize,
    offset: page * pageSize,
  });

  const toggleLogExpansion = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">{t("oauth-clients:loadingMcpLogs")}</div>
      </div>
    );
  }

  const logs = logsResponse?.data || [];
  const total = logsResponse?.total || 0;

  // Calculate stats
  const totalRequests = logs.length;
  const successfulRequests = logs.filter((log) => log.status === "success").length;
  const failedRequests = logs.filter((log) => log.status === "error").length;
  const avgDuration =
    logs.length > 0
      ? Math.round(
          logs
            .filter((log) => log.duration_ms)
            .reduce((sum, log) => sum + parseInt(log.duration_ms || "0"), 0) /
            logs.filter((log) => log.duration_ms).length,
        )
      : 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4 mb-6">
        <Link href={getLocalizedPath("/oauth-clients", locale)}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("oauth-clients:backToClients")}
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold mb-2">{t("oauth-clients:mcpRequestLogs")}</h1>
          <p className="text-muted-foreground">
            {t("oauth-clients:mcpLogsFor")} <code className="text-sm bg-muted px-2 py-1 rounded">{clientId}</code>
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("oauth-clients:totalRequests")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("oauth-clients:successful")}</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{successfulRequests}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("oauth-clients:failed")}</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{failedRequests}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("oauth-clients:avgDuration")}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgDuration}ms</div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("oauth-clients:requestLogsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("oauth-clients:noMcpLogsFound")}
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => {
                const isExpanded = expandedLogs.has(log.uuid);
                const statusColor =
                  log.status === "success" ? "text-green-500" : "text-red-500";

                return (
                  <div
                    key={log.uuid}
                    className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => toggleLogExpansion(log.uuid)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 flex-shrink-0" />
                        )}

                        <Badge className="bg-blue-500">
                          {log.tool_name}
                        </Badge>

                        {log.mcp_server_name && (
                          <span className="text-sm font-mono text-muted-foreground">
                            {log.mcp_server_name}
                          </span>
                        )}

                        <span className={`font-semibold ${statusColor}`}>
                          {log.status === "success" ? "✓" : "✗"}
                        </span>

                        <span className="text-sm text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </span>

                        {log.duration_ms && (
                          <span className="text-sm text-muted-foreground ml-auto">
                            {log.duration_ms}ms
                          </span>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pl-7 space-y-4 text-sm">
                        {/* Session Info */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="font-semibold">MCP Server:</span>{" "}
                            <span className="text-muted-foreground">
                              {log.mcp_server_name || "N/A"}
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold">Server UUID:</span>{" "}
                            <span className="font-mono text-xs">
                              {log.mcp_server_uuid || "N/A"}
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold">Session ID:</span>{" "}
                            <span className="font-mono text-xs">{log.session_id || "N/A"}</span>
                          </div>
                          <div>
                            <span className="font-semibold">Endpoint:</span>{" "}
                            <span className="text-muted-foreground">
                              {log.endpoint_name || "N/A"}
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold">Namespace:</span>{" "}
                            <span className="font-mono text-xs">
                              {log.namespace_uuid || "N/A"}
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold">User ID:</span>{" "}
                            <span className="font-mono text-xs">{log.user_id || "N/A"}</span>
                          </div>
                        </div>

                        {/* Tool Arguments */}
                        {log.tool_arguments && (
                          <div>
                            <div className="font-semibold mb-2">Tool Arguments:</div>
                            <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">
                              {JSON.stringify(log.tool_arguments, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Response Result */}
                        {log.result && (
                          <div>
                            <div className="font-semibold mb-2">Result:</div>
                            <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs max-h-96">
                              {JSON.stringify(log.result, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Error Message */}
                        {log.error_message && (
                          <div>
                            <div className="font-semibold mb-2 text-red-500">Error:</div>
                            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 rounded-md text-red-600 dark:text-red-400">
                              {log.error_message}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {total > pageSize && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of{" "}
                {total} logs
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={(page + 1) * pageSize >= total}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
