import {
  CreateMcpServerRequestSchema,
  HeadlessCreateMcpServerResponseSchema,
  HeadlessDeleteMcpServerResponseSchema,
  HeadlessGetMcpServerResponseSchema,
  HeadlessListMcpServersResponseSchema,
  HeadlessUpdateMcpServerResponseSchema,
  UpdateMcpServerRequestSchema,
} from "@repo/zod-types";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { McpServersRepository } from "../db/repositories";
import { McpServersSerializer } from "../db/serializers";

const mcpServersRepository = new McpServersRepository();

export const headlessMcpServersImplementations = {
  create: async (
    input: z.infer<typeof CreateMcpServerRequestSchema>,
  ): Promise<z.infer<typeof HeadlessCreateMcpServerResponseSchema>> => {
    try {
      const result = await mcpServersRepository.create({
        name: input.name,
        description: input.description,
        type: input.type,
        command: input.command,
        args: input.args || [],
        env: input.env || {},
        url: input.url,
        bearerToken: input.bearerToken,
        user_id: input.user_id || null, // Allow null for public servers
      });

      return {
        data: McpServersSerializer.serializeMcpServer(result),
        message: "MCP server created successfully",
      };
    } catch (error) {
      console.error("Error creating MCP server:", error);

      // Check for specific error types and throw appropriate TRPCErrors
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error.message,
          });
        }
        if (error.message.includes("is invalid")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create MCP server",
        cause: error,
      });
    }
  },

  list: async (): Promise<
    z.infer<typeof HeadlessListMcpServersResponseSchema>
  > => {
    try {
      // List all servers (no user restriction for admin)
      const mcpServers = await mcpServersRepository.findAll();

      return {
        data: McpServersSerializer.serializeMcpServerList(mcpServers),
      };
    } catch (error) {
      console.error("Error fetching MCP servers:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch MCP servers",
        cause: error,
      });
    }
  },

  get: async (input: {
    uuid: string;
  }): Promise<z.infer<typeof HeadlessGetMcpServerResponseSchema>> => {
    try {
      const mcpServer = await mcpServersRepository.findByUuid(input.uuid);

      if (!mcpServer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "MCP server not found",
        });
      }

      return {
        data: McpServersSerializer.serializeMcpServer(mcpServer),
      };
    } catch (error) {
      console.error("Error fetching MCP server:", error);

      // Re-throw TRPCErrors as-is
      if (error instanceof TRPCError) {
        throw error;
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch MCP server",
        cause: error,
      });
    }
  },

  delete: async (input: {
    uuid: string;
  }): Promise<z.infer<typeof HeadlessDeleteMcpServerResponseSchema>> => {
    try {
      const deletedServer = await mcpServersRepository.deleteByUuid(input.uuid);

      if (!deletedServer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "MCP server not found",
        });
      }

      return {
        message: "MCP server deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting MCP server:", error);

      // Re-throw TRPCErrors as-is
      if (error instanceof TRPCError) {
        throw error;
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to delete MCP server",
        cause: error,
      });
    }
  },

  update: async (
    input: z.infer<typeof UpdateMcpServerRequestSchema>,
  ): Promise<z.infer<typeof HeadlessUpdateMcpServerResponseSchema>> => {
    try {
      const result = await mcpServersRepository.update({
        uuid: input.uuid,
        name: input.name,
        description: input.description,
        type: input.type,
        command: input.command,
        args: input.args,
        env: input.env,
        url: input.url,
        bearerToken: input.bearerToken,
        user_id: input.user_id,
      });

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "MCP server not found",
        });
      }

      return {
        data: McpServersSerializer.serializeMcpServer(result),
        message: "MCP server updated successfully",
      };
    } catch (error) {
      console.error("Error updating MCP server:", error);

      // Re-throw TRPCErrors as-is
      if (error instanceof TRPCError) {
        throw error;
      }

      // Check for specific error types
      if (error instanceof Error) {
        if (error.message.includes("already exists")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: error.message,
          });
        }
        if (error.message.includes("is invalid")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update MCP server",
        cause: error,
      });
    }
  },
};
