/**
 * Error messages that may be shown to API clients. Database errors are not:
 * Drizzle's DrizzleQueryError carries the SQL text and its parameters (which
 * can include credentials being written), and PostgreSQL errors name tables
 * and constraints. They are logged server-side and replaced here.
 */

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function databaseErrorCode(error: unknown): string | null | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") return undefined;
    const candidate = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      severity?: unknown;
      cause?: unknown;
    };
    if (
      typeof candidate.severity === "string" &&
      typeof candidate.code === "string"
    ) {
      return candidate.code; // pg DatabaseError
    }
    if (
      candidate.name === "DrizzleQueryError" ||
      (typeof candidate.message === "string" &&
        candidate.message.startsWith("Failed query:"))
    ) {
      const nested = databaseErrorCode(candidate.cause);
      return nested ?? null;
    }
    current = candidate.cause;
  }
  return undefined;
}

export function isDatabaseError(error: unknown): boolean {
  return databaseErrorCode(error) !== undefined;
}

/** Message safe to return to a client for `error`. */
export function publicErrorMessage(error: unknown, fallback: string): string {
  const code = databaseErrorCode(error);
  if (code === UNIQUE_VIOLATION) {
    return "An item with the same name already exists.";
  }
  if (code === FOREIGN_KEY_VIOLATION) {
    return "This item is referenced by, or refers to, an item that does not exist.";
  }
  if (code !== undefined) {
    return fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** What an HTTP route answers when it fails: never the error itself. */
type ErrorResponse = {
  headersSent: boolean;
  status(code: number): { json(body: unknown): unknown };
  end(): unknown;
};

/**
 * Answers a failed request with a fixed message: the error object (stack,
 * internal details) never reaches the client; the caller logs it. When a
 * stream already started, it is ended instead.
 */
export function sendError(
  res: ErrorResponse,
  status: number,
  message: string,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({ error: message });
}
