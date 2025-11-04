import { and, count, desc, eq, sql } from "drizzle-orm";
import type {
  DatabaseMcpServerCallLog,
  McpServerCallLogCreateInput,
} from "@repo/zod-types";

import { db } from "../index";
import { mcpServerCallLogsTable } from "../schema";

export class McpServerCallLogsRepository {
  /**
   * Create a new MCP server call log entry
   */
  async create(
    input: McpServerCallLogCreateInput,
  ): Promise<DatabaseMcpServerCallLog> {
    const [log] = await db
      .insert(mcpServerCallLogsTable)
      .values(input)
      .returning();
    return log;
  }

  /**
   * Find MCP server call logs with optional filtering
   */
  async findMany(params: {
    clientId?: string;
    userId?: string;
    sessionId?: string;
    mcpServerUuid?: string;
    toolName?: string;
    endpointName?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: DatabaseMcpServerCallLog[]; total: number }> {
    const {
      clientId,
      userId,
      sessionId,
      mcpServerUuid,
      toolName,
      endpointName,
      limit = 50,
      offset = 0,
    } = params;

    // Build where conditions
    const whereConditions = [];
    if (clientId) {
      whereConditions.push(eq(mcpServerCallLogsTable.client_id, clientId));
    }
    if (userId) {
      whereConditions.push(eq(mcpServerCallLogsTable.user_id, userId));
    }
    if (sessionId) {
      whereConditions.push(eq(mcpServerCallLogsTable.session_id, sessionId));
    }
    if (mcpServerUuid) {
      whereConditions.push(eq(mcpServerCallLogsTable.mcp_server_uuid, mcpServerUuid));
    }
    if (toolName) {
      whereConditions.push(eq(mcpServerCallLogsTable.tool_name, toolName));
    }
    if (endpointName) {
      whereConditions.push(eq(mcpServerCallLogsTable.endpoint_name, endpointName));
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    // Get total count
    const [{ count: totalCount }] = await db
      .select({ count: count() })
      .from(mcpServerCallLogsTable)
      .where(whereClause);

    // Get logs with pagination
    const logs = await db
      .select()
      .from(mcpServerCallLogsTable)
      .where(whereClause)
      .orderBy(desc(mcpServerCallLogsTable.created_at))
      .limit(limit)
      .offset(offset);

    return {
      logs,
      total: totalCount,
    };
  }

  /**
   * Find MCP server call logs for a specific client
   */
  async findByClientId(
    clientId: string,
    limit: number = 100,
  ): Promise<DatabaseMcpServerCallLog[]> {
    return db
      .select()
      .from(mcpServerCallLogsTable)
      .where(eq(mcpServerCallLogsTable.client_id, clientId))
      .orderBy(desc(mcpServerCallLogsTable.created_at))
      .limit(limit);
  }

  /**
   * Find MCP server call logs for a specific session
   */
  async findBySessionId(
    sessionId: string,
    limit: number = 100,
  ): Promise<DatabaseMcpServerCallLog[]> {
    return db
      .select()
      .from(mcpServerCallLogsTable)
      .where(eq(mcpServerCallLogsTable.session_id, sessionId))
      .orderBy(desc(mcpServerCallLogsTable.created_at))
      .limit(limit);
  }

  /**
   * Get statistics for a client
   */
  async getClientStatistics(clientId: string): Promise<{
    total: number;
    byToolName: Record<string, number>;
    byStatus: Record<string, number>;
    byMcpServer: Record<string, number>;
    recentErrors: DatabaseMcpServerCallLog[];
    avgDurationMs: number;
  }> {
    // Get all logs for the client
    const logs = await this.findByClientId(clientId, 1000);

    // Calculate statistics
    const stats = {
      total: logs.length,
      byToolName: {} as Record<string, number>,
      byStatus: {} as Record<string, number>,
      byMcpServer: {} as Record<string, number>,
      recentErrors: logs
        .filter((log) => log.status === "error")
        .slice(0, 10),
      avgDurationMs: 0,
    };

    // Calculate averages and groupings
    let totalDuration = 0;
    let durationCount = 0;

    logs.forEach((log) => {
      stats.byToolName[log.tool_name] =
        (stats.byToolName[log.tool_name] || 0) + 1;
      stats.byStatus[log.status] =
        (stats.byStatus[log.status] || 0) + 1;

      const serverName = log.mcp_server_name || "unknown";
      stats.byMcpServer[serverName] =
        (stats.byMcpServer[serverName] || 0) + 1;

      if (log.duration_ms) {
        totalDuration += parseInt(log.duration_ms, 10);
        durationCount++;
      }
    });

    if (durationCount > 0) {
      stats.avgDurationMs = Math.round(totalDuration / durationCount);
    }

    return stats;
  }

  /**
   * Delete old logs (retention policy)
   */
  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await db
      .delete(mcpServerCallLogsTable)
      .where(sql`${mcpServerCallLogsTable.created_at} < ${cutoffDate}`)
      .returning();

    return result.length;
  }

  /**
   * Get recent MCP server call activity for a client
   */
  async getRecentActivity(
    clientId: string,
    hours: number = 24,
  ): Promise<DatabaseMcpServerCallLog[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);

    return db
      .select()
      .from(mcpServerCallLogsTable)
      .where(
        and(
          eq(mcpServerCallLogsTable.client_id, clientId),
          sql`${mcpServerCallLogsTable.created_at} > ${cutoffDate}`,
        ),
      )
      .orderBy(desc(mcpServerCallLogsTable.created_at))
      .limit(100);
  }
}

export const mcpServerCallLogsRepository = new McpServerCallLogsRepository();
