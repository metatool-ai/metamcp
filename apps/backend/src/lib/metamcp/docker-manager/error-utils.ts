interface DockerError {
  statusCode?: number;
  reason?: string;
  json?: { message?: string };
  message?: string;
}

/**
 * Docker error handling utilities
 */
export class DockerErrorUtils {
  /**
   * Determine whether a Dockerode/modem error represents a missing container (HTTP 404).
   */
  static isDockerContainerNotFoundError(error: unknown): boolean {
    const err = error as DockerError;
    if (!err || typeof err !== "object") return false;
    const statusCode = err.statusCode;
    const reason = err.reason;
    const jsonMessage = err.json?.message;
    return (
      statusCode === 404 ||
      (typeof reason === "string" &&
        reason.toLowerCase().includes("no such container")) ||
      (typeof jsonMessage === "string" &&
        jsonMessage.toLowerCase().includes("no such container"))
    );
  }

  /**
   * Produce a concise summary string for Docker errors to avoid noisy stack traces in logs.
   */
  static dockerErrorSummary(error: unknown): string {
    const err = error as DockerError;
    if (!err || typeof err !== "object") {
      return String(error);
    }
    const parts: string[] = [];
    if (err.statusCode) parts.push(`HTTP ${err.statusCode}`);
    if (err.reason) parts.push(String(err.reason));
    if (err.json?.message) parts.push(String(err.json.message));
    if (parts.length === 0 && err.message) parts.push(String(err.message));
    return parts.join(" - ") || "Unknown Docker error";
  }
}
