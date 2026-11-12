import { eq } from "drizzle-orm";

import { usersTable } from "../db/schema";

/**
 * Look up a user's email by id. Kept in its own module (with a lazy database
 * import) so access-control logic can be imported and unit-tested without a
 * database connection.
 */
export async function findUserEmailById(
  userId: string,
): Promise<string | null> {
  const { db } = await import("../db/index");
  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.email ?? null;
}
