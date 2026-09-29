import type express from "express";

/**
 * Owner (web user id) of each MCP inspector proxy session. Inspector sessions
 * are keyed by random ids only; without this, any signed-in user who learned
 * an id could send messages through someone else's session.
 */
type ProxySession = {
  userId: string;
  close?: () => Promise<void>;
  createdAt: number;
};

const owners = new Map<string, ProxySession>();

/**
 * Open inspector sessions per user. Each one holds a connection (or a
 * process) to the inspected server: past the cap, the user's oldest session
 * is closed.
 */
export const MAX_INSPECTOR_SESSIONS_PER_USER = 20;

export function recordProxySessionOwner(
  sessionId: string,
  userId: string,
  close?: () => Promise<void>,
): void {
  owners.set(sessionId, { userId, close, createdAt: Date.now() });
  const sessions = [...owners.entries()].filter(
    ([, session]) => session.userId === userId,
  );
  if (sessions.length <= MAX_INSPECTOR_SESSIONS_PER_USER) return;
  sessions.sort(([, a], [, b]) => a.createdAt - b.createdAt);
  const [oldest] = sessions;
  if (!oldest) return;
  const [oldestId, oldestSession] = oldest;
  owners.delete(oldestId);
  oldestSession.close?.().catch(() => undefined);
}

export function forgetProxySession(sessionId: string): void {
  owners.delete(sessionId);
}

/**
 * Express middleware (mount after the session auth middleware): requests that
 * reference an existing session must come from its owner.
 */
export function requireProxySessionOwner(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const headerId = req.headers["mcp-session-id"];
  const queryId = req.query.sessionId;
  const sessionId =
    typeof headerId === "string"
      ? headerId
      : typeof queryId === "string"
        ? queryId
        : undefined;
  if (!sessionId) {
    next();
    return;
  }
  const userId = (req as express.Request & { user?: { id?: string } }).user?.id;
  if (!userId || owners.get(sessionId)?.userId !== userId) {
    res.status(404).end("Session not found");
    return;
  }
  next();
}
