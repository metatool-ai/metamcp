import type { ApiKeyAuthenticatedRequest } from "@/middleware/api-key-oauth.middleware";

/**
 * Binds every public MCP session (Streamable HTTP / SSE) to the endpoint and
 * the identity that created it. Session ids used to be accepted from anyone
 * on any endpoint, so a leaked id let another caller drive the session (and
 * the admin tools attached to it). Requests on a session now have to come
 * from the same endpoint and the same user / API key.
 */
type Binding = { endpointName: string; identity: string };

const bindings = new Map<string, Binding>();

export function requestIdentity(req: ApiKeyAuthenticatedRequest): string {
  const userId = req.oauthUserId ?? req.apiKeyUserId;
  if (userId) return `user:${userId}`;
  if (req.apiKeyUuid) return `key:${req.apiKeyUuid}`;
  return "anonymous";
}

export function bindMcpSession(
  sessionId: string,
  req: ApiKeyAuthenticatedRequest,
): void {
  bindings.set(sessionId, {
    endpointName: req.endpointName,
    identity: requestIdentity(req),
  });
}

export function isMcpSessionOwner(
  sessionId: string,
  req: ApiKeyAuthenticatedRequest,
): boolean {
  const binding = bindings.get(sessionId);
  return (
    binding !== undefined &&
    binding.endpointName === req.endpointName &&
    binding.identity === requestIdentity(req)
  );
}

export function unbindMcpSession(sessionId: string): void {
  bindings.delete(sessionId);
}

/**
 * Sessions held by the caller of `req`, for the per-client session cap.
 * Unauthenticated callers all share the "anonymous" identity, so they are
 * counted per endpoint instead of across every public endpoint.
 */
export function sessionsOfCaller(req: ApiKeyAuthenticatedRequest): string[] {
  const identity = requestIdentity(req);
  const result: string[] = [];
  for (const [sessionId, binding] of bindings) {
    if (
      binding.identity === identity &&
      (identity !== "anonymous" || binding.endpointName === req.endpointName)
    ) {
      result.push(sessionId);
    }
  }
  return result;
}
