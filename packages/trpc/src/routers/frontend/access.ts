import { type AccessMe, AccessMeSchema } from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

// Current user's effective role, capabilities and groups. The frontend uses it
// to adapt navigation and actions; every check is enforced server-side too.
export const createAccessRouter = (implementations: {
  me: (userId: string) => Promise<AccessMe | null>;
}) =>
  router({
    me: protectedProcedure
      .output(AccessMeSchema.nullable())
      .query(async ({ ctx }) => {
        return await implementations.me(ctx.principal.userId);
      }),
  });
