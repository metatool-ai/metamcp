import { and, count, desc, eq, isNull, or } from "drizzle-orm";

import logger from "@/utils/logger";

import { db } from "../index";
import {
  apiKeysTable,
  mcpRequestAuditLogsTable,
  mcpServersTable,
  namespacesTable,
} from "../schema";

export interface McpRequestAuditLogCreateInput {
  endpointName: string;
  namespaceUuid: string;
  sessionId: string;
  authMethod: "api_key" | "oauth" | "none";
  apiKeyUuid?: string;
  apiKeyUserId?: string;
  oauthUserId?: string;
  mcpServerUuid?: string;
  mcpServerName?: string;
  toolName: string;
  status: "SUCCESS" | "ERROR";
  durationMs: number;
  errorMessage?: string;
}

export interface McpRequestAuditLogListInput {
  userId: string;
  limit?: number;
  offset?: number;
  endpointName?: string;
  apiKeyUuid?: string;
  namespaceUuid?: string;
  status?: "SUCCESS" | "ERROR";
}

export class McpRequestAuditLogsRepository {
  async create(input: McpRequestAuditLogCreateInput): Promise<void> {
    try {
      await db.insert(mcpRequestAuditLogsTable).values({
        endpoint_name: input.endpointName,
        namespace_uuid: input.namespaceUuid,
        session_id: input.sessionId,
        auth_method: input.authMethod,
        api_key_uuid: input.apiKeyUuid,
        api_key_user_id: input.apiKeyUserId,
        oauth_user_id: input.oauthUserId,
        mcp_server_uuid: input.mcpServerUuid,
        mcp_server_name: input.mcpServerName,
        tool_name: input.toolName,
        status: input.status,
        duration_ms: input.durationMs,
        error_message: input.errorMessage,
      });
    } catch (error) {
      logger.error("Failed to persist MCP request audit log:", error);
    }
  }

  private getAccessibleWhereConditions(userId: string) {
    return [
      or(
        eq(mcpRequestAuditLogsTable.api_key_user_id, userId),
        eq(mcpRequestAuditLogsTable.oauth_user_id, userId),
        isNull(mcpRequestAuditLogsTable.api_key_user_id),
      ),
    ];
  }

  private getListWhereConditions(input: McpRequestAuditLogListInput) {
    const whereConditions = [
      ...this.getAccessibleWhereConditions(input.userId),
    ];

    if (input.endpointName) {
      whereConditions.push(
        eq(mcpRequestAuditLogsTable.endpoint_name, input.endpointName),
      );
    }

    if (input.apiKeyUuid) {
      whereConditions.push(
        eq(mcpRequestAuditLogsTable.api_key_uuid, input.apiKeyUuid),
      );
    }

    if (input.namespaceUuid) {
      whereConditions.push(
        eq(mcpRequestAuditLogsTable.namespace_uuid, input.namespaceUuid),
      );
    }

    if (input.status) {
      whereConditions.push(eq(mcpRequestAuditLogsTable.status, input.status));
    }

    return whereConditions;
  }

  async list(input: McpRequestAuditLogListInput) {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    const whereConditions = this.getListWhereConditions(input);
    const whereClause = and(...whereConditions);

    const [rows, totalRows, apiKeyFilters, namespaceFilters, statusFilters] =
      await Promise.all([
        db
          .select({
            uuid: mcpRequestAuditLogsTable.uuid,
            created_at: mcpRequestAuditLogsTable.created_at,
            endpoint_name: mcpRequestAuditLogsTable.endpoint_name,
            namespace_uuid: mcpRequestAuditLogsTable.namespace_uuid,
            namespace_name: namespacesTable.name,
            session_id: mcpRequestAuditLogsTable.session_id,
            auth_method: mcpRequestAuditLogsTable.auth_method,
            api_key_uuid: mcpRequestAuditLogsTable.api_key_uuid,
            api_key_name: apiKeysTable.name,
            api_key_user_id: mcpRequestAuditLogsTable.api_key_user_id,
            oauth_user_id: mcpRequestAuditLogsTable.oauth_user_id,
            mcp_server_uuid: mcpRequestAuditLogsTable.mcp_server_uuid,
            mcp_server_name: mcpRequestAuditLogsTable.mcp_server_name,
            registered_mcp_server_name: mcpServersTable.name,
            tool_name: mcpRequestAuditLogsTable.tool_name,
            status: mcpRequestAuditLogsTable.status,
            duration_ms: mcpRequestAuditLogsTable.duration_ms,
            error_message: mcpRequestAuditLogsTable.error_message,
          })
          .from(mcpRequestAuditLogsTable)
          .leftJoin(
            apiKeysTable,
            eq(apiKeysTable.uuid, mcpRequestAuditLogsTable.api_key_uuid),
          )
          .leftJoin(
            namespacesTable,
            eq(namespacesTable.uuid, mcpRequestAuditLogsTable.namespace_uuid),
          )
          .leftJoin(
            mcpServersTable,
            eq(mcpServersTable.uuid, mcpRequestAuditLogsTable.mcp_server_uuid),
          )
          .where(whereClause)
          .orderBy(desc(mcpRequestAuditLogsTable.created_at))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: count() })
          .from(mcpRequestAuditLogsTable)
          .where(whereClause),
        this.listApiKeyFilters(input),
        this.listNamespaceFilters(input),
        this.listStatusFilters(input),
      ]);

    return {
      logs: rows.map((row) => ({
        ...row,
        mcp_server_name: row.mcp_server_name ?? row.registered_mcp_server_name,
      })),
      totalCount: totalRows[0]?.count ?? 0,
      filters: {
        apiKeys: apiKeyFilters,
        namespaces: namespaceFilters,
        statuses: statusFilters,
      },
    };
  }

  private async listApiKeyFilters(input: McpRequestAuditLogListInput) {
    const whereConditions = this.getListWhereConditions({
      ...input,
      apiKeyUuid: undefined,
    });

    return db
      .select({
        uuid: mcpRequestAuditLogsTable.api_key_uuid,
        name: apiKeysTable.name,
        count: count(),
      })
      .from(mcpRequestAuditLogsTable)
      .leftJoin(
        apiKeysTable,
        eq(apiKeysTable.uuid, mcpRequestAuditLogsTable.api_key_uuid),
      )
      .where(and(...whereConditions))
      .groupBy(mcpRequestAuditLogsTable.api_key_uuid, apiKeysTable.name)
      .orderBy(desc(count()));
  }

  private async listNamespaceFilters(input: McpRequestAuditLogListInput) {
    const whereConditions = this.getListWhereConditions({
      ...input,
      namespaceUuid: undefined,
    });

    return db
      .select({
        uuid: mcpRequestAuditLogsTable.namespace_uuid,
        name: namespacesTable.name,
        count: count(),
      })
      .from(mcpRequestAuditLogsTable)
      .leftJoin(
        namespacesTable,
        eq(namespacesTable.uuid, mcpRequestAuditLogsTable.namespace_uuid),
      )
      .where(and(...whereConditions))
      .groupBy(mcpRequestAuditLogsTable.namespace_uuid, namespacesTable.name)
      .orderBy(desc(count()));
  }

  private async listStatusFilters(input: McpRequestAuditLogListInput) {
    const whereConditions = this.getListWhereConditions({
      ...input,
      status: undefined,
    });

    return db
      .select({
        status: mcpRequestAuditLogsTable.status,
        count: count(),
      })
      .from(mcpRequestAuditLogsTable)
      .where(and(...whereConditions))
      .groupBy(mcpRequestAuditLogsTable.status)
      .orderBy(desc(count()));
  }
}

export const mcpRequestAuditLogsRepository =
  new McpRequestAuditLogsRepository();
