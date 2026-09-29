"use client";

import {
  type Capability,
  isShareLevelAtLeast,
  type ResourceAccess,
  type ShareLevel,
} from "@repo/zod-types";

import { useSyncExternalStore } from "react";

import { trpc } from "@/lib/trpc";

const subscribeNoop = () => () => {};

/**
 * False while React hydrates server-rendered HTML, true afterwards.
 *
 * The access query only runs in the browser, but a lazily hydrated subtree
 * (e.g. inside a Suspense boundary) can hydrate after its response arrived;
 * rendering it would then no longer match the server HTML.
 */
function useHydrated() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/**
 * Effective role, capabilities and groups of the signed-in user.
 *
 * Only used to adapt the UI (hide actions the user cannot perform); every
 * permission is enforced by the backend as well.
 */
export function useAccess() {
  const hydrated = useHydrated();
  const query = trpc.frontend.access.me.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const me = hydrated ? (query.data ?? null) : null;
  const isAdmin = me?.isAdmin ?? false;

  const can = (capability: Capability) =>
    Boolean(me && (me.isAdmin || me.capabilities.includes(capability)));

  return {
    me,
    isAdmin,
    role: me?.role ?? null,
    isLoading: !hydrated || query.isLoading,
    can,
    refetch: query.refetch,
  };
}

/** Whether a resource-level access grants at least `level`. */
export function hasAccessLevel(
  access: ResourceAccess | null | undefined,
  level: ShareLevel,
): boolean {
  return isShareLevelAtLeast(access?.level, level);
}
