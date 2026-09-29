import type { AccessMe } from "@repo/zod-types";

import { accessService } from "../lib/access/access.service";

export const accessImplementations = {
  me: async (userId: string): Promise<AccessMe | null> => {
    return await accessService.getMe(userId);
  },
};
