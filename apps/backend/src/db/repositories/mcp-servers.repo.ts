import {
  DatabaseMcpServer,
  McpServerCreateInput,
  McpServerErrorStatusEnum,
  McpServerUpdateInput,
} from "@repo/zod-types";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { DatabaseError } from "pg";
import { z } from "zod";

import { db } from "../index";
import { mcpServersTable } from "../schema";

// Helper function to handle PostgreSQL errors
function handleDatabaseError(
  error: unknown,
  operation: string,
  serverName?: string,
): never {
  console.error(`Database error in ${operation}:`, error);

  // Extract the actual PostgreSQL error from Drizzle's error structure
  let pgError: DatabaseError | undefined;

  if (
    error instanceof Error &&
    "cause" in error &&
    error.cause instanceof DatabaseError
  ) {
    // Drizzle wraps the PostgreSQL error in the cause property
    pgError = error.cause;
  } else if (error instanceof DatabaseError) {
    // Direct PostgreSQL error
    pgError = error;
  }

  if (pgError) {
    // Handle unique constraint violation for server name
    if (
      pgError.code === "23505" &&
      pgError.constraint === "mcp_servers_name_user_unique_idx"
    ) {
      throw new Error(
        `Server name "${serverName}" already exists. Server names must be unique within your scope.`,
      );
    }

    // Handle regex constraint violation for server name
    if (
      pgError.code === "23514" &&
      pgError.constraint === "mcp_servers_name_regex_check"
    ) {
      throw new Error(
        `Server name "${serverName}" is invalid. Server names must only contain letters, numbers, underscores, and hyphens.`,
      );
    }
  }

  // For any other database errors, throw a generic user-friendly message
  throw new Error(
    `Failed to ${operation} MCP server. Please check your input and try again.`,
  );
}

export class McpServersRepository {
  async create(input: McpServerCreateInput): Promise<DatabaseMcpServer> {
    try {
      const [createdServer] = await db
        .insert(mcpServersTable)
        .values(input)
        .returning();

      return createdServer;
    } catch (error: unknown) {
      handleDatabaseError(error, "create", input.name);
    }
  }

  async findAll(): Promise<DatabaseMcpServer[]> {
    return await db
      .select()
      .from(mcpServersTable)
      .orderBy(desc(mcpServersTable.created_at));
  }

  // Find servers accessible to a specific user (public + user's own servers)
  async findAllAccessibleToUser(userId: string): Promise<DatabaseMcpServer[]> {
    return await db
      .select()
      .from(mcpServersTable)
      .where(
        or(
          isNull(mcpServersTable.user_id), // Public servers
          eq(mcpServersTable.user_id, userId), // User's own servers
        ),
      )
      .orderBy(desc(mcpServersTable.created_at));
  }

  // Find only public servers (no user ownership)
  async findPublicServers(): Promise<DatabaseMcpServer[]> {
    return await db
      .select()
      .from(mcpServersTable)
      .where(isNull(mcpServersTable.user_id))
      .orderBy(desc(mcpServersTable.created_at));
  }

  // Find servers owned by a specific user
  async findByUserId(userId: string): Promise<DatabaseMcpServer[]> {
    return await db
      .select()
      .from(mcpServersTable)
      .where(eq(mcpServersTable.user_id, userId))
      .orderBy(desc(mcpServersTable.created_at));
  }

  async findByUuid(uuid: string): Promise<DatabaseMcpServer | undefined> {
    const [server] = await db
      .select()
      .from(mcpServersTable)
      .where(eq(mcpServersTable.uuid, uuid))
      .limit(1);

    return server;
  }

  async findByName(name: string): Promise<DatabaseMcpServer | undefined> {
    const [server] = await db
      .select()
      .from(mcpServersTable)
      .where(eq(mcpServersTable.name, name))
      .limit(1);

    return server;
  }

  // Find server by name within user scope (for uniqueness checks)
  async findByNameAndUserId(
    name: string,
    userId: string | null,
  ): Promise<DatabaseMcpServer | undefined> {
    const [server] = await db
      .select()
      .from(mcpServersTable)
      .where(
        and(
          eq(mcpServersTable.name, name),
          userId
            ? eq(mcpServersTable.user_id, userId)
            : isNull(mcpServersTable.user_id),
        ),
      )
      .limit(1);

    return server;
  }

  async deleteByUuid(uuid: string): Promise<DatabaseMcpServer | undefined> {
    const [deletedServer] = await db
      .delete(mcpServersTable)
      .where(eq(mcpServersTable.uuid, uuid))
      .returning();

    return deletedServer;
  }

  async update(
    input: McpServerUpdateInput,
  ): Promise<DatabaseMcpServer | undefined> {
    const { uuid, ...updateData } = input;

    try {
      const [updatedServer] = await db
        .update(mcpServersTable)
        .set(updateData)
        .where(eq(mcpServersTable.uuid, uuid))
        .returning();

      return updatedServer;
    } catch (error: unknown) {
      handleDatabaseError(error, "update", input.name);
    }
  }

  async bulkCreate(
    servers: McpServerCreateInput[],
  ): Promise<DatabaseMcpServer[]> {
    try {
      return await db.insert(mcpServersTable).values(servers).returning();
    } catch (error: unknown) {
      // For bulk operations, we don't have a specific server name to report
      // Extract the actual PostgreSQL error from Drizzle's error structure
      let pgError: DatabaseError | undefined;

      if (
        error instanceof Error &&
        "cause" in error &&
        error.cause instanceof DatabaseError
      ) {
        pgError = error.cause;
      } else if (error instanceof DatabaseError) {
        pgError = error;
      }

      if (pgError) {
        // Handle unique constraint violation for server name
        if (
          pgError.code === "23505" &&
          pgError.constraint === "mcp_servers_name_user_unique_idx"
        ) {
          throw new Error(
            "One or more server names already exist. Server names must be unique within your scope.",
          );
        }

        // Handle regex constraint violation for server name
        if (
          pgError.code === "23514" &&
          pgError.constraint === "mcp_servers_name_regex_check"
        ) {
          throw new Error(
            "One or more server names are invalid. Server names must only contain letters, numbers, underscores, and hyphens.",
          );
        }
      }

      console.error("Database error in bulk create:", error);
      throw new Error(
        "Failed to bulk create MCP servers. Please check your input and try again.",
      );
    }
  }

  async updateServerErrorStatus(input: {
    serverUuid: string;
    errorStatus: z.infer<typeof McpServerErrorStatusEnum>;
  }) {
    const [updatedServer] = await db
      .update(mcpServersTable)
      .set({
        error_status: input.errorStatus,
      })
      .where(eq(mcpServersTable.uuid, input.serverUuid))
      .returning();

    return updatedServer;
  }
}

export const mcpServersRepository = new McpServersRepository();
