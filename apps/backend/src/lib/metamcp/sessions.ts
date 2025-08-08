import { ServerParameters } from "@repo/zod-types";

import { ConnectedClient, connectMetaMcpClient } from "./client";

/**
 * Simple in-memory session cache:
 * sessionId -> (serverUuid -> ConnectedClient)
 */
const sessionStore: Map<string, Map<string, ConnectedClient>> = new Map();

export const getOrConnectSessionClient = async (
  sessionId: string,
  serverUuid: string,
  serverParams: ServerParameters,
): Promise<ConnectedClient | undefined> => {
  let serverMap = sessionStore.get(sessionId);
  if (!serverMap) {
    serverMap = new Map<string, ConnectedClient>();
    sessionStore.set(sessionId, serverMap);
  }

  const existing = serverMap.get(serverUuid);
  if (existing) {
    return existing;
  }

  const connected = await connectMetaMcpClient(serverUuid, serverParams);
  if (connected) {
    serverMap.set(serverUuid, connected);
  }
  return connected;
};

export const getSessionClients = (
  sessionId: string,
): Map<string, ConnectedClient> | undefined => {
  return sessionStore.get(sessionId);
};

export const removeSessionClient = (
  sessionId: string,
  serverUuid: string,
): void => {
  const serverMap = sessionStore.get(sessionId);
  if (!serverMap) return;
  serverMap.delete(serverUuid);
  if (serverMap.size === 0) {
    sessionStore.delete(sessionId);
  }
};

export const cleanupSession = async (sessionId: string): Promise<void> => {
  const serverMap = sessionStore.get(sessionId);
  if (!serverMap) return;

  const cleanupTasks: Array<Promise<void>> = [];
  for (const [, connected] of serverMap) {
    try {
      cleanupTasks.push(connected.cleanup());
    } catch {
      // ignore cleanup errors per connection
    }
  }

  try {
    await Promise.allSettled(cleanupTasks);
  } finally {
    sessionStore.delete(sessionId);
  }
};

export const cleanupAllSessions = async (): Promise<void> => {
  const allSessionIds = Array.from(sessionStore.keys());
  const tasks = allSessionIds.map((id) => cleanupSession(id));
  await Promise.allSettled(tasks);
};
