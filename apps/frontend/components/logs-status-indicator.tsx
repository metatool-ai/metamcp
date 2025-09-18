"use client";

// import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useLogsStore } from "@/lib/stores/logs-store";

export function LogsStatusIndicator() {
  const { totalCount, isAutoRefreshing } = useLogsStore();
  // const [recentErrorCount, setRecentErrorCount] = useState(0);

  // Count recent errors (last 5 minutes) - REMOVED
  // useEffect(() => {
  //   const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  //   const recentErrors = logs.filter(
  //     (log) =>
  //       log.level === "error" && new Date(log.timestamp) > fiveMinutesAgo,
  //   ).length;
  //   setRecentErrorCount(recentErrors);
  // }, [logs]);

  if (totalCount === 0) {
    return (
      <div className="flex items-center gap-1">
        {isAutoRefreshing && (
          <div
            className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
            title="Live updates active"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="text-xs px-1.5 py-0.5">
        {totalCount}
      </Badge>
      {/* Removed red error badge */}
      {/* {recentErrorCount > 0 && (
        <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
          {recentErrorCount}
        </Badge>
      )} */}
      {isAutoRefreshing && (
        <div
          className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
          title="Live updates active"
        />
      )}
    </div>
  );
}
