"use client";

import { OAuthRequestLog } from "@repo/zod-types";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  RefreshCw,
  Server,
  Timer,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "@/hooks/useTranslations";
import { getLocalizedPath, SupportedLocale } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";

type OAuthRequestLogDisplay = Omit<OAuthRequestLog, "created_at"> & {
  created_at: string;
};

export default function OAuthClientLogsPage() {
  const params = useParams();
  const clientId = params.clientId as string;
  const locale = params.locale as SupportedLocale;
  const { t } = useTranslations();

  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const limit = 50;

  // Get OAuth request logs
  const {
    data: logsResponse,
    isLoading,
    refetch,
  } = trpc.frontend.oauth.getRequestLogs.useQuery({
    clientId,
    limit,
    offset: page * limit,
  });

  const logs: OAuthRequestLogDisplay[] = logsResponse?.success
    ? logsResponse.data
    : [];
  const total = logsResponse?.total || 0;
  const totalPages = Math.ceil(total / limit);

  // Toggle log expansion
  const toggleLog = (logId: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Get status badge variant
  const getStatusVariant = (status: string): "success" | "destructive" | "neutral" => {
    const statusCode = parseInt(status);
    if (statusCode >= 200 && statusCode < 300) return "success";
    if (statusCode >= 400) return "destructive";
    return "neutral";
  };

  // Get request type badge color
  const getRequestTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "authorization":
        return "text-blue-600 bg-blue-50 border-blue-200";
      case "token":
        return "text-green-600 bg-green-50 border-green-200";
      case "refresh":
        return "text-purple-600 bg-purple-50 border-purple-200";
      case "userinfo":
        return "text-orange-600 bg-orange-50 border-orange-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link href={getLocalizedPath("/oauth-clients", locale)}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("oauth-clients:backToClients")}
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{t("oauth-clients:requestLogs")}</h1>
          <p className="text-muted-foreground">
            {t("oauth-clients:logsFor")} <code className="text-sm bg-muted px-2 py-1 rounded">{clientId}</code>
          </p>
        </div>
        <Button onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          {t("common:refresh")}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4" />
              {t("oauth-clients:totalRequests")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {t("oauth-clients:successfulRequests")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {logs.filter((l) => parseInt(l.response_status) < 400).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" />
              {t("oauth-clients:failedRequests")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {logs.filter((l) => parseInt(l.response_status) >= 400).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Timer className="h-4 w-4" />
              {t("oauth-clients:avgDuration")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {logs.length > 0
                ? Math.round(
                    logs
                      .filter((l) => l.duration_ms)
                      .reduce((sum, l) => sum + parseInt(l.duration_ms!), 0) /
                      logs.filter((l) => l.duration_ms).length,
                  )
                : 0}
              ms
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("oauth-clients:requestHistory")}</CardTitle>
          <CardDescription>
            {t("oauth-clients:detailedRequestLogs")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-12">
              <Server className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {t("oauth-clients:noLogs")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("oauth-clients:logsWillAppear")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <Collapsible
                  key={log.uuid}
                  open={expandedLogs.has(log.uuid)}
                  onOpenChange={() => toggleLog(log.uuid)}
                >
                  <Card className="border">
                    <CollapsibleTrigger asChild>
                      <div className="px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-muted/50 transition-colors">
                        {expandedLogs.has(log.uuid) ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}

                        {/* Timestamp */}
                        <div className="flex items-center gap-2 min-w-[180px]">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatDate(log.created_at)}
                          </span>
                        </div>

                        {/* Request Type */}
                        <Badge className={getRequestTypeColor(log.request_type)}>
                          {log.request_type.toUpperCase()}
                        </Badge>

                        {/* Method & Path */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Badge variant="outline" className="text-xs">
                            {log.request_method}
                          </Badge>
                          <code className="text-xs truncate">{log.request_path}</code>
                        </div>

                        {/* Status */}
                        <Badge variant={getStatusVariant(log.response_status)}>
                          {log.response_status}
                        </Badge>

                        {/* Duration */}
                        {log.duration_ms && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-[60px]">
                            <Clock className="h-3 w-3" />
                            {log.duration_ms}ms
                          </div>
                        )}
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t px-4 py-4 space-y-4 bg-muted/20">
                        {/* User & IP Info */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {log.user_id && (
                            <div>
                              <span className="font-medium">User ID:</span>
                              <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">
                                {log.user_id}
                              </code>
                            </div>
                          )}
                          {log.ip_address && (
                            <div>
                              <span className="font-medium">IP Address:</span>
                              <code className="ml-2 text-xs bg-muted px-2 py-1 rounded">
                                {log.ip_address}
                              </code>
                            </div>
                          )}
                        </div>

                        {/* User Agent */}
                        {log.user_agent && (
                          <div className="text-sm">
                            <span className="font-medium">User Agent:</span>
                            <div className="mt-1 text-xs text-muted-foreground font-mono">
                              {log.user_agent}
                            </div>
                          </div>
                        )}

                        {/* Error Message */}
                        {log.error_message && (
                          <div className="bg-red-50 border border-red-200 rounded-md p-3">
                            <div className="flex items-center gap-2 text-red-700 font-medium mb-1">
                              <AlertCircle className="h-4 w-4" />
                              Error
                            </div>
                            <div className="text-sm text-red-600 font-mono">
                              {log.error_message}
                            </div>
                          </div>
                        )}

                        {/* Request Details */}
                        {log.request_query && Object.keys(log.request_query).length > 0 && (
                          <div>
                            <div className="font-medium text-sm mb-2">Query Parameters:</div>
                            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                              {JSON.stringify(log.request_query, null, 2)}
                            </pre>
                          </div>
                        )}

                        {log.request_body && Object.keys(log.request_body).length > 0 && (
                          <div>
                            <div className="font-medium text-sm mb-2">Request Body:</div>
                            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                              {JSON.stringify(log.request_body, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Response Body */}
                        {log.response_body && Object.keys(log.response_body).length > 0 && (
                          <div>
                            <div className="font-medium text-sm mb-2">Response Body:</div>
                            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-96">
                              {JSON.stringify(log.response_body, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                {t("oauth-clients:showingLogs", {
                  from: page * limit + 1,
                  to: Math.min((page + 1) * limit, total),
                  total,
                })}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  {t("common:previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                >
                  {t("common:next")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
