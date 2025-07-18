import {
  CreateMcpServerRequestSchema,
  HeadlessCreateMcpServerResponseSchema,
  HeadlessDeleteMcpServerResponseSchema,
  HeadlessGetMcpServerResponseSchema,
  HeadlessListMcpServersResponseSchema,
  HeadlessUpdateMcpServerResponseSchema,
  UpdateMcpServerRequestSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { createHeadlessRouter } from "../../trpc";

// Headless MCP servers router with OpenAPI metadata
export const createHeadlessMcpServersRouter = (implementations: {
  create: (
    input: z.infer<typeof CreateMcpServerRequestSchema>,
  ) => Promise<z.infer<typeof HeadlessCreateMcpServerResponseSchema>>;
  list: () => Promise<z.infer<typeof HeadlessListMcpServersResponseSchema>>;
  get: (input: {
    uuid: string;
  }) => Promise<z.infer<typeof HeadlessGetMcpServerResponseSchema>>;
  delete: (input: {
    uuid: string;
  }) => Promise<z.infer<typeof HeadlessDeleteMcpServerResponseSchema>>;
  update: (
    input: z.infer<typeof UpdateMcpServerRequestSchema>,
  ) => Promise<z.infer<typeof HeadlessUpdateMcpServerResponseSchema>>;
}) => {
  const headlessTRPC = createHeadlessRouter();

  return headlessTRPC.router({
    // List all MCP servers
    list: headlessTRPC.procedure
      .meta({
        openapi: {
          method: "GET",
          path: "/headless/mcp-servers",
          tags: ["MCP Servers"],
          summary: "List all MCP servers",
          description:
            "Retrieve a list of all MCP servers in the system. Requires admin API key.",
        },
      })
      .input(z.void())
      .output(HeadlessListMcpServersResponseSchema)
      .query(async () => {
        return await implementations.list();
      }),

    // Get single MCP server by UUID
    get: headlessTRPC.procedure
      .meta({
        openapi: {
          method: "GET",
          path: "/headless/mcp-servers/{uuid}",
          tags: ["MCP Servers"],
          summary: "Get MCP server by UUID",
          description:
            "Retrieve a specific MCP server by its UUID. Requires admin API key.",
        },
      })
      .input(
        z.object({
          uuid: z.string().uuid().describe("The UUID of the MCP server"),
        }),
      )
      .output(HeadlessGetMcpServerResponseSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    // Create MCP server
    create: headlessTRPC.procedure
      .meta({
        openapi: {
          method: "POST",
          path: "/headless/mcp-servers",
          tags: ["MCP Servers"],
          summary: "Create a new MCP server",
          description:
            "Create a new MCP server in the system. Requires admin API key.",
        },
      })
      .input(CreateMcpServerRequestSchema)
      .output(HeadlessCreateMcpServerResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.create(input);
      }),

    // Delete MCP server
    delete: headlessTRPC.procedure
      .meta({
        openapi: {
          method: "DELETE",
          path: "/headless/mcp-servers/{uuid}",
          tags: ["MCP Servers"],
          summary: "Delete MCP server",
          description:
            "Delete an MCP server by its UUID. Requires admin API key.",
        },
      })
      .input(
        z.object({
          uuid: z
            .string()
            .uuid()
            .describe("The UUID of the MCP server to delete"),
        }),
      )
      .output(HeadlessDeleteMcpServerResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.delete(input);
      }),

    // Update MCP server
    update: headlessTRPC.procedure
      .meta({
        openapi: {
          method: "PUT",
          path: "/headless/mcp-servers/{uuid}",
          tags: ["MCP Servers"],
          summary: "Update MCP server",
          description:
            "Update an existing MCP server by its UUID. Requires admin API key.",
        },
      })
      .input(UpdateMcpServerRequestSchema)
      .output(HeadlessUpdateMcpServerResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.update(input);
      }),
  });
};
