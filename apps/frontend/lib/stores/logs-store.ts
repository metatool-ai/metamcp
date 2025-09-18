import { MetaMcpLogEntry } from "@repo/zod-types";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { vanillaTrpcClient } from "../trpc";

interface LogsState {
  logs: MetaMcpLogEntry[];
  isLoading: boolean;
  isAutoRefreshing: boolean;
  totalCount: number;
  lastFetch: Date | null;

  // Actions
  fetchLogs: () => Promise<void>;
  clearLogs: () => Promise<void>;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
  setAutoRefresh: (enabled: boolean) => void;
}

let refreshInterval: NodeJS.Timeout | null = null;
const REFRESH_INTERVAL = 2000; // 2 seconds
const AUTO_REFRESH_STORAGE_KEY = "metamcp-auto-refresh-enabled";

// Helper functions for localStorage
const getStoredAutoRefreshState = (): boolean => {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  return stored ? JSON.parse(stored) : true; // Default to true (enabled)
};

const setStoredAutoRefreshState = (enabled: boolean): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(enabled));
};

export const useLogsStore = create<LogsState>()(
  subscribeWithSelector((set, get) => ({
    logs: [],
    isLoading: false,
    isAutoRefreshing: getStoredAutoRefreshState(), // Load from localStorage
    totalCount: 0,
    lastFetch: null,

    fetchLogs: async () => {
      try {
        set({ isLoading: true });

        const response = await vanillaTrpcClient.frontend.logs.get.query({
          limit: 500,
        });

        if (response.success) {
          set({
            logs:
              response.data?.map((log) => ({
                ...log,
                timestamp: new Date(log.timestamp),
              })) || [],
            totalCount: response.totalCount || 0,
            lastFetch: new Date(),
            isLoading: false,
          });
        }
      } catch (error) {
        console.error("Failed to fetch logs:", error);
        set({ isLoading: false });

        // Check if it's an authentication error
        if (error && typeof error === "object" && "message" in error) {
          const errorMessage = String(error.message);
          if (
            errorMessage.includes("UNAUTHORIZED") ||
            errorMessage.includes("You must be logged in")
          ) {
            // Stop auto-refresh if user is not authenticated
            const currentState = get();
            if (currentState.isAutoRefreshing) {
              currentState.stopAutoRefresh();
              console.log("Auto-refresh stopped due to authentication error");
            }
          }
        }
      }
    },

    clearLogs: async () => {
      try {
        await vanillaTrpcClient.frontend.logs.clear.mutate();
        set({ logs: [], totalCount: 0 });
      } catch (error) {
        console.error("Failed to clear logs:", error);

        // Check if it's an authentication error
        if (error && typeof error === "object" && "message" in error) {
          const errorMessage = String(error.message);
          if (
            errorMessage.includes("UNAUTHORIZED") ||
            errorMessage.includes("You must be logged in")
          ) {
            // Stop auto-refresh if user is not authenticated
            const currentState = get();
            if (currentState.isAutoRefreshing) {
              currentState.stopAutoRefresh();
              console.log(
                "Auto-refresh stopped due to authentication error in clearLogs",
              );
            }
          }
        }
      }
    },

    startAutoRefresh: () => {
      const state = get();
      if (refreshInterval) return; // Already running

      // Fetch immediately
      state.fetchLogs();

      // Set up interval
      refreshInterval = setInterval(() => {
        const currentState = get();
        if (currentState.isAutoRefreshing) {
          currentState.fetchLogs();
        }
      }, REFRESH_INTERVAL);

      set({ isAutoRefreshing: true });
      setStoredAutoRefreshState(true); // Persist to localStorage
    },

    stopAutoRefresh: () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
      set({ isAutoRefreshing: false });
      setStoredAutoRefreshState(false); // Persist to localStorage
    },

    setAutoRefresh: (enabled: boolean) => {
      if (enabled) {
        get().startAutoRefresh();
      } else {
        get().stopAutoRefresh();
      }
    },
  })),
);

// Initialize auto-refresh based on stored preference
if (typeof window !== "undefined") {
  // Only start in browser environment and if user previously enabled it
  setTimeout(() => {
    const shouldAutoRefresh = getStoredAutoRefreshState();
    if (shouldAutoRefresh) {
      useLogsStore.getState().startAutoRefresh();
    }
    // Always fetch logs once when the page loads
    useLogsStore.getState().fetchLogs();
  }, 100);
}

// Cleanup on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });
}
