"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
  Trash2,
  X,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Notification } from "@/lib/notificationTypes";

interface NotificationEntry {
  id: string;
  notification: Notification;
  timestamp: Date;
  type: "notification" | "stderr";
}

interface NotificationsPanelProps {
  notifications: NotificationEntry[];
  onClearNotifications: () => void;
  onRemoveNotification: (id: string) => void;
}

type NotificationFilterType = "all" | "info" | "progress" | "stderr";

interface NotificationCounts {
  all: number;
  info: number;
  progress: number;
  stderr: number;
}

export function NotificationsPanel({
  notifications,
  onClearNotifications,
  onRemoveNotification,
}: NotificationsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeFilter, setActiveFilter] =
    useState<NotificationFilterType>("all");

  const { filteredNotifications, counts } = useMemo(() => {
    const counts: NotificationCounts = {
      all: notifications.length,
      info: 0,
      progress: 0,
      stderr: 0,
    };

    // Count notifications by type
    notifications.forEach((notification) => {
      if (notification.type === "stderr") {
        counts.stderr++;
      } else if (notification.notification.method?.includes("progress")) {
        counts.progress++;
      } else {
        counts.info++;
      }
    });

    // Filter notifications based on active filter
    const filtered = notifications.filter((notification) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "stderr") return notification.type === "stderr";
      if (activeFilter === "progress") {
        return notification.notification.method?.includes("progress");
      }
      if (activeFilter === "info") {
        return (
          notification.type !== "stderr" &&
          !notification.notification.method?.includes("progress")
        );
      }
      return true;
    });

    return { filteredNotifications: filtered, counts };
  }, [notifications, activeFilter]);

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString();
  };

  const getNotificationTypeInfo = (notification: NotificationEntry) => {
    if (notification.type === "stderr") {
      return {
        icon: AlertTriangle,
        color: "text-red-600 dark:text-red-400",
        bgColor: "bg-red-50 dark:bg-red-950/20",
        borderColor: "border-red-200 dark:border-red-800",
        badge: "stderr",
        badgeVariant: "destructive" as const,
      };
    }

    // Handle different notification methods
    const method = notification.notification.method;
    if (method?.includes("progress")) {
      return {
        icon: Bell,
        color: "text-blue-600 dark:text-blue-400",
        bgColor: "bg-blue-50 dark:bg-blue-950/20",
        borderColor: "border-blue-200 dark:border-blue-800",
        badge: "progress",
        badgeVariant: "secondary" as const,
      };
    }

    return {
      icon: Bell,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-950/20",
      borderColor: "border-green-200 dark:border-green-800",
      badge: "info",
      badgeVariant: "default" as const,
    };
  };

  const renderNotificationContent = (notification: NotificationEntry) => {
    if (notification.type === "stderr") {
      return (
        <div className="text-xs text-red-700 dark:text-red-300 font-mono bg-red-50 dark:bg-red-950/20 p-1.5 rounded border border-red-200 dark:border-red-800">
          {(notification.notification as any).params?.content ||
            "stderr output"}
        </div>
      );
    }

    // For other notifications, display the method and params
    const method = notification.notification.method;
    const params = (notification.notification as any).params;

    return (
      <div className="space-y-1">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
          Method:{" "}
          <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
            {method}
          </code>
        </div>
        {params && (
          <div className="text-xs text-gray-600 dark:text-gray-400">
            <div className="font-medium mb-0.5">Parameters:</div>
            <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-1.5 rounded border overflow-x-auto">
              {JSON.stringify(params, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <Card className="w-full shadow-none">
      <CardHeader className="py-1 pb-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-sm">MCP Notifications</CardTitle>
            <Badge variant="outline" className="text-xs h-4 px-1">
              {notifications.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onClearNotifications}
              disabled={notifications.length === 0}
              className="h-6 text-xs px-2"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-6 w-6 p-0"
            >
              {isExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0 px-2 pb-2">
          <Tabs
            value={activeFilter}
            onValueChange={(value) =>
              setActiveFilter(value as NotificationFilterType)
            }
          >
            <div className="flex justify-start">
              <TabsList className="h-8 p-0.5 inline-flex w-auto">
                <TabsTrigger
                  value="all"
                  className="text-xs h-6 px-3 flex items-center gap-1"
                >
                  <Bell className="h-3 w-3" />
                  All
                  <Badge variant="outline" className="text-xs h-3.5 px-1 ml-1">
                    {counts.all}
                  </Badge>
                </TabsTrigger>

                <TabsTrigger
                  value="info"
                  className="text-xs h-6 px-3 flex items-center gap-1"
                >
                  <Info className="h-3 w-3" />
                  Info
                  <Badge
                    variant={counts.info > 0 ? "default" : "outline"}
                    className="text-xs h-3.5 px-1 ml-1"
                  >
                    {counts.info}
                  </Badge>
                </TabsTrigger>

                <TabsTrigger
                  value="progress"
                  className="text-xs h-6 px-3 flex items-center gap-1"
                >
                  <Activity className="h-3 w-3" />
                  Progress
                  <Badge
                    variant={counts.progress > 0 ? "secondary" : "outline"}
                    className="text-xs h-3.5 px-1 ml-1"
                  >
                    {counts.progress}
                  </Badge>
                </TabsTrigger>

                <TabsTrigger
                  value="stderr"
                  className="text-xs h-6 px-3 flex items-center gap-1"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Stderr
                  <Badge
                    variant={counts.stderr > 0 ? "destructive" : "outline"}
                    className="text-xs h-3.5 px-1 ml-1"
                  >
                    {counts.stderr}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value={activeFilter} className="mt-2">
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {filteredNotifications.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-4">
                    No {activeFilter === "all" ? "" : activeFilter}{" "}
                    notifications
                  </div>
                ) : (
                  filteredNotifications.map((notification) => {
                    const typeInfo = getNotificationTypeInfo(notification);
                    const Icon = typeInfo.icon;

                    return (
                      <div key={notification.id}>
                        <div
                          className={`p-1.5 rounded border ${typeInfo.bgColor} ${typeInfo.borderColor}`}
                        >
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <Icon
                                className={`h-3 w-3 flex-shrink-0 ${typeInfo.color}`}
                              />
                              <Badge
                                variant={typeInfo.badgeVariant}
                                className="text-xs py-0 h-3.5 px-1"
                              >
                                {typeInfo.badge}
                              </Badge>
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {formatTimestamp(notification.timestamp)}
                              </span>
                            </div>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-4 w-4 p-0 flex-shrink-0"
                              onClick={() =>
                                onRemoveNotification(notification.id)
                              }
                            >
                              <X className="h-2.5 w-2.5" />
                            </Button>
                          </div>

                          <div>{renderNotificationContent(notification)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}
