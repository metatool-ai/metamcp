import type { ListActivityRequest } from "@repo/zod-types";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lte,
  or,
  SQL,
} from "drizzle-orm";

import { db } from "../index";
import { activityLogsTable } from "../schema";

export type ActivityLogInsert = typeof activityLogsTable.$inferInsert;
export type ActivityLogRow = typeof activityLogsTable.$inferSelect;

type Filters = Omit<ListActivityRequest, "offset" | "limit">;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function whereClause(filters: Filters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (filters.category) {
    conditions.push(eq(activityLogsTable.category, filters.category));
  }
  if (filters.outcome) {
    conditions.push(eq(activityLogsTable.outcome, filters.outcome));
  }
  if (filters.actorId) {
    conditions.push(eq(activityLogsTable.actor_id, filters.actorId));
  }
  if (filters.targetId) {
    conditions.push(eq(activityLogsTable.target_id, filters.targetId));
  }
  if (filters.from) {
    conditions.push(gte(activityLogsTable.created_at, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(activityLogsTable.created_at, filters.to));
  }
  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(
      or(
        ilike(activityLogsTable.actor_email, pattern),
        ilike(activityLogsTable.actor_name, pattern),
        ilike(activityLogsTable.target_label, pattern),
        ilike(activityLogsTable.target_id, pattern),
        ilike(activityLogsTable.action, pattern),
        ilike(activityLogsTable.ip_address, pattern),
      ),
    );
  }
  const defined = conditions.filter((condition): condition is SQL =>
    Boolean(condition),
  );
  return defined.length > 0 ? and(...defined) : undefined;
}

export class ActivityLogsRepository {
  async insert(entry: ActivityLogInsert): Promise<void> {
    await db.insert(activityLogsTable).values(entry);
  }

  async list(
    filters: Filters,
    offset: number,
    limit: number,
  ): Promise<{ rows: ActivityLogRow[]; total: number }> {
    const where = whereClause(filters);
    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(activityLogsTable)
        .where(where)
        .orderBy(
          desc(activityLogsTable.created_at),
          desc(activityLogsTable.uuid),
        )
        .offset(offset)
        .limit(limit),
      db.select({ total: count() }).from(activityLogsTable).where(where),
    ]);
    return { rows, total: totals?.total ?? 0 };
  }

  /** Retention: removes entries older than `cutoff`, returns how many. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await db
      .delete(activityLogsTable)
      .where(lt(activityLogsTable.created_at, cutoff))
      .returning({ uuid: activityLogsTable.uuid });
    return deleted.length;
  }
}

export const activityLogsRepository = new ActivityLogsRepository();
