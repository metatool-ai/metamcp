import { and, count, desc, eq, sql } from "drizzle-orm";
import type {
  DatabaseMcpRequestLog,
  McpRequestLogCreateInput,
} from "@repo/zod-types";

import { db } from "../drizzle";
import { mcpRequestLogsTable } from "../schema";

export class McpRequestLogsRepository {
  /**
   * Create a new MCP request log entry
   */
  async create(
    input: McpRequestLogCreateInput,
  ): Promise<DatabaseMcpRequestLog> {
    const [log] = await db
      .insert(mcpRequestLogsTable)
      .values(input)
      .returning();
    return log;
  }

  /**
   * Find MCP request logs with optional filtering
   */
  async findMany(params: {
    clientId?: string;
    userId?: string;
    sessionId?: string;
    requestType?: string;
    endpointName?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: DatabaseMcpRequestLog[]; total: number }> {
    const {
      clientId,
      userId,
      sessionId,
      requestType,
      endpointName,
      limit = 50,
      offset = 0,
    } = params;

    // Build where conditions
    const whereConditions = [];
    if (clientId) {
      whereConditions.push(eq(mcpRequestLogsTable.client_id, clientId));
    }
    if (userId) {
      whereConditions.push(eq(mcpRequestLogsTable.user_id, userId));
    }
    if (sessionId) {
      whereConditions.push(eq(mcpRequestLogsTable.session_id, sessionId));
    }
    if (requestType) {
      whereConditions.push(eq(mcpRequestLogsTable.request_type, requestType));
    }
    if (endpointName) {
      whereConditions.push(eq(mcpRequestLogsTable.endpoint_name, endpointName));
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Get total count
    const [{ count: totalCount }] = await db
      .select({ count: count() })
      .from(mcpRequestLogsTable)
      .where(whereClause);

    // Get logs with pagination
    const logs = await db
      .select()
      .from(mcpRequestLogsTable)
      .where(whereClause)
      .orderBy(desc(mcpRequestLogsTable.created_at))
      .limit(limit)
      .offset(offset);

    return {
      logs,
      total: totalCount,
    };
  }

  /**
   * Find MCP request logs for a specific client
   */
  async findByClientId(
    clientId: string,
    limit: number = 100,
  ): Promise<DatabaseMcpRequestLog[]> {
    return db
      .select()
      .from(mcpRequestLogsTable)
      .where(eq(mcpRequestLogsTable.client_id, clientId))
      .orderBy(desc(mcpRequestLogsTable.created_at))
      .limit(limit);
  }

  /**
   * Find MCP request logs for a specific session
   */
  async findBySessionId(
    sessionId: string,
    limit: number = 100,
  ): Promise<DatabaseMcpRequestLog[]> {
    return db
      .select()
      .from(mcpRequestLogsTable)
      .where(eq(mcpRequestLogsTable.session_id, sessionId))
      .orderBy(desc(mcpRequestLogsTable.created_at))
      .limit(limit);
  }

  /**
   * Get statistics for a client
   */
  async getClientStatistics(clientId: string): Promise<{
    total: number;
    byRequestType: Record<string, number>;
    byStatus: Record<string, number>;
    recentErrors: DatabaseMcpRequestLog[];
  }> {
    // Get all logs for the client
    const logs = await this.findByClientId(clientId, 1000);

    // Calculate statistics
    const stats = {
      total: logs.length,
      byRequestType: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      recentErrors: logs
        .filter((log) => log.response_status === "error")
        .slice(0, 10),
    };

    // Group by request type
    logs.forEach((log) => {
      stats.byRequestType[log.request_type] =
        (stats.byRequestType[log.request_type] || 0) + 1;
      stats.byStatus[log.response_status] =
        (stats.byStatus[log.response_status] || 0) + 1;
    });

    return stats;
  }

  /**
   * Delete old logs (retention policy)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await db
      .delete(mcpRequestLogsTable)
      .where(sql`${mcpRequestLogsTable.created_at} < ${cutoffDate}`)
      .returning();

    return result.length;
  }

  /**
   * Get recent MCP activity for a client
   */
  async getRecentActivity(
    clientId: string,
    hours: number = 24,
  ): Promise<DatabaseMcpRequestLog[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);

    return db
      .select()
      .from(mcpRequestLogsTable)
      .where(
        and(
          eq(mcpRequestLogsTable.client_id, clientId),
          sql`${mcpRequestLogsTable.created_at} > ${cutoffDate}`,
        ),
      )
      .orderBy(desc(mcpRequestLogsTable.created_at))
      .limit(100);
  }
}

export const mcpRequestLogsRepository = new McpRequestLogsRepository();
