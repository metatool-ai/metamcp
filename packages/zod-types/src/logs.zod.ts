import { z } from "zod";

export const MetaMcpLogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  serverName: z.string(),
  level: z.enum(["error", "info", "warn"]),
  message: z.string(),
  error: z.string().optional(),
});

export const GetLogsRequestSchema = z.object({
  limit: z.number().int().positive().max(1000).optional(),
});

export const GetLogsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(MetaMcpLogEntrySchema),
  totalCount: z.number(),
});

export const ClearLogsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// Docker logs (per MCP server)
export const ListDockerServersResponseSchema = z.object({
  success: z.literal(true),
  servers: z.array(
    z.object({
      serverUuid: z.string(),
      containerId: z.string(),
      containerName: z.string(),
      serverName: z.string(),
    }),
  ),
});

export const GetDockerLogsRequestSchema = z.object({
  serverUuid: z.string(),
  tail: z.number().int().positive().max(5000).optional(),
});

export const GetDockerLogsResponseSchema = z.object({
  success: z.literal(true),
  serverUuid: z.string(),
  lines: z.array(z.string()),
});

export type MetaMcpLogEntry = z.infer<typeof MetaMcpLogEntrySchema>;
export type GetLogsRequest = z.infer<typeof GetLogsRequestSchema>;
export type GetLogsResponse = z.infer<typeof GetLogsResponseSchema>;
export type ClearLogsResponse = z.infer<typeof ClearLogsResponseSchema>;
export type ListDockerServersResponse = z.infer<
  typeof ListDockerServersResponseSchema
>;
export type GetDockerLogsRequest = z.infer<typeof GetDockerLogsRequestSchema>;
export type GetDockerLogsResponse = z.infer<typeof GetDockerLogsResponseSchema>;
