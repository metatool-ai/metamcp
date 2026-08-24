export interface AdminToolsSessionContext {
  enabled: boolean;
  userId: string;
}

const adminContextByInternalSessionId = new Map<
  string,
  AdminToolsSessionContext
>();

export function setAdminToolsContext(
  internalSessionId: string,
  context: AdminToolsSessionContext,
): void {
  adminContextByInternalSessionId.set(internalSessionId, context);
}

export function getAdminToolsContext(
  internalSessionId: string,
): AdminToolsSessionContext | undefined {
  return adminContextByInternalSessionId.get(internalSessionId);
}

export function clearAdminToolsContext(internalSessionId: string): void {
  adminContextByInternalSessionId.delete(internalSessionId);
}
