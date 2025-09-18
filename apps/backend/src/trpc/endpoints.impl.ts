import {
  CreateEndpointRequestSchema,
  CreateEndpointResponseSchema,
  DeleteEndpointResponseSchema,
  GetEndpointResponseSchema,
  ListEndpointsResponseSchema,
  UpdateEndpointRequestSchema,
  UpdateEndpointResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import {
  ApiKeysRepository,
  endpointsRepository,
  mcpServersRepository,
  namespacesRepository,
} from "../db/repositories";
import { EndpointsSerializer } from "../db/serializers";

const apiKeysRepository = new ApiKeysRepository();

export const endpointsImplementations = {
  create: async (
    input: z.infer<typeof CreateEndpointRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CreateEndpointResponseSchema>> => {
    try {
      // Check if endpoint name already exists (must be globally unique)
      const existingEndpoint = await endpointsRepository.findByName(input.name);
      if (existingEndpoint) {
        return {
          success: false as const,
          message: "Endpoint name already exists",
        };
      }

      // Determine user ownership based on input.user_id or default to current user
      const effectiveUserId =
        input.user_id !== undefined ? input.user_id : userId;
      const isPublicEndpoint = effectiveUserId === null;

      // Validate namespace accessibility and relationship rules
      const namespace = await namespacesRepository.findByUuid(
        input.namespaceUuid,
      );
      if (!namespace) {
        return {
          success: false as const,
          message: "Selected namespace could not be found",
        };
      }

      // Check if user has access to this namespace (own namespace or public namespace)
      if (namespace.user_id && namespace.user_id !== userId) {
        return {
          success: false as const,
          message: `Access denied: You don't have permission to use namespace "${namespace.name}"`,
        };
      }

      // Enforce relationship rules: public endpoints can only use public namespaces
      if (isPublicEndpoint && namespace.user_id !== null) {
        return {
          success: false as const,
          message: `Access denied: Public endpoints can only use public namespaces. Namespace "${namespace.name}" is private`,
        };
      }

      const result = await endpointsRepository.create({
        name: input.name,
        description: input.description,
        namespace_uuid: input.namespaceUuid,
        enable_api_key_auth: input.enableApiKeyAuth ?? true,
        enable_oauth: input.enableOauth ?? false,
        use_query_param_auth: input.useQueryParamAuth ?? false,
        user_id: effectiveUserId,
      });

      // Create MCP server if requested
      if (input.createMcpServer) {
        try {
          const mcpServerName = `${input.name}-endpoint`;
          const mcpServerDescription = `Auto-generated MCP server for endpoint "${input.name}"`;

          const baseUrl = process.env.APP_URL;
          const endpointUrl = `${baseUrl}/metamcp/${input.name}/mcp`;

          // Get or create API key for bearer token only if API key auth is enabled
          let bearerToken = "";
          if (input.enableApiKeyAuth) {
            try {
              const userApiKeys = await apiKeysRepository.findByUserId(userId);
              const activeApiKey = userApiKeys.find((key) => key.is_active);

              if (activeApiKey) {
                bearerToken = activeApiKey.key;
              } else {
                // Create a new API key if none exists
                const newApiKey = await apiKeysRepository.create({
                  name: "Auto-generated for MCP Server",
                  user_id: userId,
                  is_active: true,
                });
                bearerToken = newApiKey.key;
              }
            } catch (apiKeyError) {
              console.error(
                "Error getting API key for MCP server:",
                apiKeyError,
              );
              // Continue without bearer token if API key operation fails
            }
          }

          await mcpServersRepository.create({
            name: mcpServerName,
            description: mcpServerDescription,
            type: "STREAMABLE_HTTP",
            url: endpointUrl,
            bearerToken: bearerToken,
            command: "",
            args: [],
            env: {},
            user_id: effectiveUserId,
          });
        } catch (mcpError) {
          console.error("Error creating MCP server:", mcpError);
          // Don't fail the endpoint creation if MCP server creation fails
          // Just log the error and continue
        }
      }

      return {
        success: true as const,
        data: EndpointsSerializer.serializeEndpoint(result),
        message: "Endpoint created successfully",
      };
    } catch (error) {
      console.error("Error creating endpoint:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  list: async (
    userId: string,
  ): Promise<z.infer<typeof ListEndpointsResponseSchema>> => {
    try {
      // Get endpoints accessible to user (public + user's own) with namespace data
      const endpoints =
        await endpointsRepository.findAllAccessibleToUserWithNamespaces(userId);

      return {
        success: true as const,
        data: EndpointsSerializer.serializeEndpointWithNamespaceList(endpoints),
        message: "Endpoints retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching endpoints:", error);
      return {
        success: false as const,
        data: [],
        message: "Failed to fetch endpoints",
      };
    }
  },

  get: async (
    input: {
      uuid: string;
    },
    userId: string,
  ): Promise<z.infer<typeof GetEndpointResponseSchema>> => {
    try {
      const endpoint = await endpointsRepository.findByUuidWithNamespace(
        input.uuid,
      );

      if (!endpoint) {
        return {
          success: false as const,
          message: "Endpoint not found",
        };
      }

      // Check if user has access to this endpoint (own endpoint or public endpoint)
      if (endpoint.user_id && endpoint.user_id !== userId) {
        return {
          success: false as const,
          message:
            "Access denied: You can only view endpoints you own or public endpoints",
        };
      }

      return {
        success: true as const,
        data: EndpointsSerializer.serializeEndpointWithNamespace(endpoint),
        message: "Endpoint retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching endpoint:", error);
      return {
        success: false as const,
        message: "Failed to fetch endpoint",
      };
    }
  },

  delete: async (
    input: {
      uuid: string;
    },
    userId: string,
  ): Promise<z.infer<typeof DeleteEndpointResponseSchema>> => {
    try {
      // First, check if the endpoint exists and user has permission to delete it
      const existingEndpoint =
        await endpointsRepository.findByUuidWithNamespace(input.uuid);

      if (!existingEndpoint) {
        return {
          success: false as const,
          message: "Endpoint not found",
        };
      }

      // Check if user owns this endpoint (only owners can delete, protect public endpoints)
      if (existingEndpoint.user_id && existingEndpoint.user_id !== userId) {
        return {
          success: false as const,
          message: "Access denied: You can only delete endpoints you own",
        };
      }

      const deletedEndpoint = await endpointsRepository.deleteByUuid(
        input.uuid,
      );

      if (!deletedEndpoint) {
        return {
          success: false as const,
          message: "Endpoint not found",
        };
      }

      return {
        success: true as const,
        message: "Endpoint deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting endpoint:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  update: async (
    input: z.infer<typeof UpdateEndpointRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateEndpointResponseSchema>> => {
    try {
      // First, check if the endpoint exists and user has permission to update it
      const existingEndpoint =
        await endpointsRepository.findByUuidWithNamespace(input.uuid);

      if (!existingEndpoint) {
        return {
          success: false as const,
          message: "Endpoint not found",
        };
      }

      // Check if user owns this endpoint (only owners can update)
      if (existingEndpoint.user_id && existingEndpoint.user_id !== userId) {
        return {
          success: false as const,
          message: "Access denied: You can only update endpoints you own",
        };
      }

      const isPublicEndpoint = existingEndpoint.user_id === null;

      // Validate namespace accessibility and relationship rules if namespace is being updated
      if (input.namespaceUuid !== existingEndpoint.namespace_uuid) {
        const namespace = await namespacesRepository.findByUuid(
          input.namespaceUuid,
        );
        if (!namespace) {
          return {
            success: false as const,
            message: "Selected namespace could not be found",
          };
        }

        // Check if user has access to this namespace (own namespace or public namespace)
        if (namespace.user_id && namespace.user_id !== userId) {
          return {
            success: false as const,
            message: `Access denied: You don't have permission to use namespace "${namespace.name}"`,
          };
        }

        // Enforce relationship rules: public endpoints can only use public namespaces
        if (isPublicEndpoint && namespace.user_id !== null) {
          return {
            success: false as const,
            message: `Access denied: Public endpoints can only use public namespaces. Namespace "${namespace.name}" is private`,
          };
        }
      }

      // Check if another endpoint with the same name exists (excluding current one)
      const duplicateEndpoint = await endpointsRepository.findByName(
        input.name,
      );
      if (duplicateEndpoint && duplicateEndpoint.uuid !== input.uuid) {
        return {
          success: false as const,
          message: "Endpoint name already exists",
        };
      }

      const result = await endpointsRepository.update({
        uuid: input.uuid,
        name: input.name,
        description: input.description,
        namespace_uuid: input.namespaceUuid,
        enable_api_key_auth: input.enableApiKeyAuth,
        enable_oauth: input.enableOauth,
        use_query_param_auth: input.useQueryParamAuth,
      });

      return {
        success: true as const,
        data: EndpointsSerializer.serializeEndpoint(result),
        message: "Endpoint updated successfully",
      };
    } catch (error) {
      console.error("Error updating endpoint:", error);
      return {
        success: false as const,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },
};
