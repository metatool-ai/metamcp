import {
  DatabaseEndpoint,
  DatabaseEndpointWithNamespace,
  EndpointCreateInput,
  EndpointUpdateInput,
} from "@repo/zod-types";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db } from "../index";
import { endpointsTable, namespacesTable } from "../schema";

export class EndpointsRepository {
  async create(input: EndpointCreateInput): Promise<DatabaseEndpoint> {
    const [createdEndpoint] = await db
      .insert(endpointsTable)
      .values({
        name: input.name,
        description: input.description,
        namespace_uuid: input.namespace_uuid,
        enable_api_key_auth: input.enable_api_key_auth ?? true,
        enable_oauth: input.enable_oauth ?? false,
        use_query_param_auth: input.use_query_param_auth ?? false,
        user_id: input.user_id,
      })
      .returning();

    if (!createdEndpoint) {
      throw new Error("Failed to create endpoint");
    }

    return createdEndpoint;
  }

  async findAll(): Promise<DatabaseEndpoint[]> {
    return await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .orderBy(desc(endpointsTable.created_at));
  }

  // Find endpoints accessible to a specific user (public + user's own endpoints)
  async findAllAccessibleToUser(userId: string): Promise<DatabaseEndpoint[]> {
    return await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .where(
        or(
          isNull(endpointsTable.user_id), // Public endpoints
          eq(endpointsTable.user_id, userId), // User's own endpoints
        ),
      )
      .orderBy(desc(endpointsTable.created_at));
  }

  // Find endpoints accessible to a specific user with namespace data (public + user's own endpoints)
  async findAllAccessibleToUserWithNamespaces(
    userId: string,
  ): Promise<DatabaseEndpointWithNamespace[]> {
    const endpointsData = await db
      .select({
        // Endpoint fields
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
        // Namespace fields
        namespace: {
          uuid: namespacesTable.uuid,
          name: namespacesTable.name,
          description: namespacesTable.description,
          created_at: namespacesTable.created_at,
          updated_at: namespacesTable.updated_at,
          user_id: namespacesTable.user_id,
        },
      })
      .from(endpointsTable)
      .innerJoin(
        namespacesTable,
        eq(endpointsTable.namespace_uuid, namespacesTable.uuid),
      )
      .where(
        or(
          isNull(endpointsTable.user_id), // Public endpoints
          eq(endpointsTable.user_id, userId), // User's own endpoints
        ),
      )
      .orderBy(desc(endpointsTable.created_at));

    return endpointsData;
  }

  // Find only public endpoints (no user ownership)
  async findPublicEndpoints(): Promise<DatabaseEndpoint[]> {
    return await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .where(isNull(endpointsTable.user_id))
      .orderBy(desc(endpointsTable.created_at));
  }

  // Find endpoints owned by a specific user
  async findByUserId(userId: string): Promise<DatabaseEndpoint[]> {
    return await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .where(eq(endpointsTable.user_id, userId))
      .orderBy(desc(endpointsTable.created_at));
  }

  async findAllWithNamespaces(): Promise<DatabaseEndpointWithNamespace[]> {
    const endpointsData = await db
      .select({
        // Endpoint fields
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
        // Namespace fields
        namespace: {
          uuid: namespacesTable.uuid,
          name: namespacesTable.name,
          description: namespacesTable.description,
          created_at: namespacesTable.created_at,
          updated_at: namespacesTable.updated_at,
          user_id: namespacesTable.user_id,
        },
      })
      .from(endpointsTable)
      .innerJoin(
        namespacesTable,
        eq(endpointsTable.namespace_uuid, namespacesTable.uuid),
      )
      .orderBy(desc(endpointsTable.created_at));

    return endpointsData;
  }

  async findByUuid(uuid: string): Promise<DatabaseEndpoint | undefined> {
    const [endpoint] = await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .where(eq(endpointsTable.uuid, uuid));

    return endpoint;
  }

  async findByUuidWithNamespace(
    uuid: string,
  ): Promise<DatabaseEndpointWithNamespace | undefined> {
    const [endpointData] = await db
      .select({
        // Endpoint fields
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
        // Namespace fields
        namespace: {
          uuid: namespacesTable.uuid,
          name: namespacesTable.name,
          description: namespacesTable.description,
          created_at: namespacesTable.created_at,
          updated_at: namespacesTable.updated_at,
          user_id: namespacesTable.user_id,
        },
      })
      .from(endpointsTable)
      .innerJoin(
        namespacesTable,
        eq(endpointsTable.namespace_uuid, namespacesTable.uuid),
      )
      .where(eq(endpointsTable.uuid, uuid));

    return endpointData;
  }

  async findByName(name: string): Promise<DatabaseEndpoint | undefined> {
    const [endpoint] = await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .where(eq(endpointsTable.name, name));

    return endpoint;
  }

  // Find endpoint by name within user scope (for uniqueness checks)
  async findByNameAndUserId(
    name: string,
    userId: string | null,
  ): Promise<DatabaseEndpoint | undefined> {
    const [endpoint] = await db
      .select({
        uuid: endpointsTable.uuid,
        name: endpointsTable.name,
        description: endpointsTable.description,
        namespace_uuid: endpointsTable.namespace_uuid,
        enable_api_key_auth: endpointsTable.enable_api_key_auth,
        enable_oauth: endpointsTable.enable_oauth,
        use_query_param_auth: endpointsTable.use_query_param_auth,
        created_at: endpointsTable.created_at,
        updated_at: endpointsTable.updated_at,
        user_id: endpointsTable.user_id,
      })
      .from(endpointsTable)
      .where(
        and(
          eq(endpointsTable.name, name),
          userId
            ? eq(endpointsTable.user_id, userId)
            : isNull(endpointsTable.user_id),
        ),
      )
      .limit(1);

    return endpoint;
  }

  async deleteByUuid(uuid: string): Promise<DatabaseEndpoint | undefined> {
    const [deletedEndpoint] = await db
      .delete(endpointsTable)
      .where(eq(endpointsTable.uuid, uuid))
      .returning();

    return deletedEndpoint;
  }

  async update(input: EndpointUpdateInput): Promise<DatabaseEndpoint> {
    const [updatedEndpoint] = await db
      .update(endpointsTable)
      .set({
        name: input.name,
        description: input.description,
        namespace_uuid: input.namespace_uuid,
        enable_api_key_auth: input.enable_api_key_auth,
        enable_oauth: input.enable_oauth,
        use_query_param_auth: input.use_query_param_auth,
        user_id: input.user_id,
        updated_at: new Date(),
      })
      .where(eq(endpointsTable.uuid, input.uuid))
      .returning();

    if (!updatedEndpoint) {
      throw new Error("Failed to update endpoint");
    }

    return updatedEndpoint;
  }
}

// Export the repository instance
export const endpointsRepository = new EndpointsRepository();
