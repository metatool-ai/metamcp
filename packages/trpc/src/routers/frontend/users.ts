import {
  GetAllUsersRequest,
  GetAllUsersRequestSchema,
  GetAllUsersResponse,
  UpdateUserAdminAccessRequest,
  UpdateUserAdminAccessRequestSchema,
  UpdateUserAdminAccessResponse,
} from "@repo/zod-types";

import { protectedProcedure, router } from "../../trpc";

export const createUsersRouter = (implementations: {
  getAllUsers: (input: GetAllUsersRequest) => Promise<GetAllUsersResponse>;
  updateUserAdminAccess: (
    input: UpdateUserAdminAccessRequest,
  ) => Promise<UpdateUserAdminAccessResponse>;
}) =>
  router({
    getAllUsers: protectedProcedure
      .input(GetAllUsersRequestSchema)
      .query(async ({ input }) => {
        return await implementations.getAllUsers(input);
      }),

    updateUserAdminAccess: protectedProcedure
      .input(UpdateUserAdminAccessRequestSchema)
      .mutation(async ({ input }) => {
        return await implementations.updateUserAdminAccess(input);
      }),
  });
