import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request state shared between better-auth callbacks that don't receive
 * each other's data: `mapProfileToUser` (sees the OIDC claims) and the
 * database hooks (see the user/session being created).
 *
 * Every call to `auth.handler` runs inside `runWithAuthRequestContext`.
 */
export type AuthRequestStore = {
  /**
   * Set during an OIDC callback: group values read from the configured claim,
   * or null when the claim was absent (unknown, not "no groups").
   */
  oidc?: { groups: string[] | null; email: string | null };
  /**
   * Trusted server-side operations (bootstrap, admin-created users) bypass the
   * "registration disabled" switches, which only target self-service sign-up.
   */
  bypassSignupRestrictions?: boolean;
};

const storage = new AsyncLocalStorage<AuthRequestStore>();

export function runWithAuthRequestContext<T>(
  store: AuthRequestStore,
  fn: () => T,
): T {
  return storage.run(store, fn);
}

export function getAuthRequestStore(): AuthRequestStore | undefined {
  return storage.getStore();
}
