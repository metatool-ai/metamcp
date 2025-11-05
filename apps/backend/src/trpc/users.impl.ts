import {
  GetAllUsersRequestSchema,
  GetAllUsersResponseSchema,
  UpdateUserAdminAccessRequestSchema,
  UpdateUserAdminAccessResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { usersRepo } from "../db/repositories";

export const usersImplementations = {
  getAllUsers: async (
    input: z.infer<typeof GetAllUsersRequestSchema>,
  ): Promise<z.infer<typeof GetAllUsersResponseSchema>> => {
    try {
      const { users, total } = await usersRepo.getAllUsers({
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        data: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          isAdmin: user.isAdmin,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        })),
        total,
      };
    } catch (error) {
      console.error("Error fetching users:", error);
      return {
        success: false,
        data: [],
        total: 0,
        message: "Failed to fetch users",
      };
    }
  },

  updateUserAdminAccess: async (
    input: z.infer<typeof UpdateUserAdminAccessRequestSchema>,
  ): Promise<z.infer<typeof UpdateUserAdminAccessResponseSchema>> => {
    try {
      await usersRepo.updateUserAdminAccess(input.userId, input.isAdmin);
      return {
        success: true,
        message: input.isAdmin
          ? "Admin access granted successfully"
          : "Admin access revoked successfully",
      };
    } catch (error) {
      console.error("Error updating user admin access:", error);
      return {
        success: false,
        message: "Failed to update admin access",
      };
    }
  },
};
