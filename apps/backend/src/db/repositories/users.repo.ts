import { eq, desc } from "drizzle-orm";

import { db } from "../index";
import { usersTable } from "../schema";

export const usersRepo = {
  /**
   * Get all users with pagination
   */
  async getAllUsers(params: {
    limit?: number;
    offset?: number;
  }): Promise<{ users: typeof usersTable.$inferSelect[]; total: number }> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const [users, totalResult] = await Promise.all([
      db
        .select()
        .from(usersTable)
        .orderBy(desc(usersTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: db.$count(usersTable) }).from(usersTable),
    ]);

    const total = totalResult[0]?.count ?? 0;

    return { users, total };
  },

  /**
   * Get a user by ID
   */
  async getUserById(id: string): Promise<typeof usersTable.$inferSelect | undefined> {
    const result = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    return result[0];
  },

  /**
   * Update user admin access
   */
  async updateUserAdminAccess(userId: string, isAdmin: boolean): Promise<void> {
    await db
      .update(usersTable)
      .set({
        isAdmin,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
  },

  /**
   * Check if user is admin
   */
  async isUserAdmin(userId: string): Promise<boolean> {
    const user = await this.getUserById(userId);
    return user?.isAdmin ?? false;
  },
};
