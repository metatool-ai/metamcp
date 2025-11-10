import {
  DatabaseOAuthRequestLog,
  OAuthRequestLogCreateInput,
} from "@repo/zod-types";
import { desc, eq, and, sql } from "drizzle-orm";

import { db } from "../index";
import { oauthRequestLogsTable } from "../schema";

export class OAuthRequestLogsRepository {
  /**
   * Create a new OAuth request log entry
   */
  async create(
    input: OAuthRequestLogCreateInput,
  ): Promise<DatabaseOAuthRequestLog> {
    const [log] = await db
      .insert(oauthRequestLogsTable)
      .values(input)
      .returning();

    return log;
  }

  /**
   * Get OAuth request logs with optional filtering by client_id
   * Supports pagination via limit and offset
   */
  async findMany(params: {
    clientId?: string;
    userId?: string;
    requestType?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: DatabaseOAuthRequestLog[]; total: number }> {
    const { clientId, userId, requestType, limit = 50, offset = 0 } = params;

    // Build where conditions
    const conditions = [];
    if (clientId) {
      conditions.push(eq(oauthRequestLogsTable.client_id, clientId));
    }
    if (userId) {
      conditions.push(eq(oauthRequestLogsTable.user_id, userId));
    }
    if (requestType) {
      conditions.push(eq(oauthRequestLogsTable.request_type, requestType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(oauthRequestLogsTable)
      .where(whereClause);

    // Get paginated logs
    const logs = await db
      .select()
      .from(oauthRequestLogsTable)
      .where(whereClause)
      .orderBy(desc(oauthRequestLogsTable.created_at))
      .limit(limit)
      .offset(offset);

    return {
      logs,
      total: count || 0,
    };
  }

  /**
   * Get logs for a specific client
   */
  async findByClientId(
    clientId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ logs: DatabaseOAuthRequestLog[]; total: number }> {
    return this.findMany({ clientId, limit, offset });
  }

  /**
   * Get logs for a specific user
   */
  async findByUserId(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ logs: DatabaseOAuthRequestLog[]; total: number }> {
    return this.findMany({ userId, limit, offset });
  }

  /**
   * Get a single log entry by UUID
   */
  async findByUuid(uuid: string): Promise<DatabaseOAuthRequestLog | undefined> {
    const [log] = await db
      .select()
      .from(oauthRequestLogsTable)
      .where(eq(oauthRequestLogsTable.uuid, uuid))
      .limit(1);

    return log;
  }

  /**
   * Delete old logs (for cleanup/retention policies)
   * Deletes logs older than the specified number of days
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await db
      .delete(oauthRequestLogsTable)
      .where(sql`${oauthRequestLogsTable.created_at} < ${cutoffDate}`)
      .returning({ uuid: oauthRequestLogsTable.uuid });

    return result.length;
  }

  /**
   * Get statistics about OAuth requests for a client
   */
  async getClientStatistics(clientId: string): Promise<{
    total: number;
    byRequestType: Record<string, number>;
    byStatus: Record<string, number>;
    recentErrors: DatabaseOAuthRequestLog[];
  }> {
    // Total requests
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(oauthRequestLogsTable)
      .where(eq(oauthRequestLogsTable.client_id, clientId));

    // By request type
    const typeResults = await db
      .select({
        request_type: oauthRequestLogsTable.request_type,
        count: sql<number>`count(*)::int`,
      })
      .from(oauthRequestLogsTable)
      .where(eq(oauthRequestLogsTable.client_id, clientId))
      .groupBy(oauthRequestLogsTable.request_type);

    const byRequestType: Record<string, number> = {};
    typeResults.forEach((row) => {
      byRequestType[row.request_type] = row.count;
    });

    // By status code
    const statusResults = await db
      .select({
        response_status: oauthRequestLogsTable.response_status,
        count: sql<number>`count(*)::int`,
      })
      .from(oauthRequestLogsTable)
      .where(eq(oauthRequestLogsTable.client_id, clientId))
      .groupBy(oauthRequestLogsTable.response_status);

    const byStatus: Record<string, number> = {};
    statusResults.forEach((row) => {
      byStatus[row.response_status] = row.count;
    });

    // Recent errors (status >= 400)
    const recentErrors = await db
      .select()
      .from(oauthRequestLogsTable)
      .where(
        and(
          eq(oauthRequestLogsTable.client_id, clientId),
          sql`${oauthRequestLogsTable.response_status}::int >= 400`,
        ),
      )
      .orderBy(desc(oauthRequestLogsTable.created_at))
      .limit(10);

    return {
      total: total || 0,
      byRequestType,
      byStatus,
      recentErrors,
    };
  }
}

export const oauthRequestLogsRepository = new OAuthRequestLogsRepository();
