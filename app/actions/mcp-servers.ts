'use server';

import { and, desc, eq, or } from 'drizzle-orm';

import { db } from '@/db';
import { mcpServersTable, McpServerStatus, McpServerType } from '@/db/schema';
import { McpServer } from '@/types/mcp-server';

export async function getMcpServers(
  profileUuid: string,
  status?: McpServerStatus
) {
  // Return empty array if profile UUID is empty
  if (!profileUuid) {
    return [];
  }

  const servers = await db
    .select()
    .from(mcpServersTable)
    .where(
      and(
        eq(mcpServersTable.profile_uuid, profileUuid),
        status
          ? eq(mcpServersTable.status, status)
          : or(
              eq(mcpServersTable.status, McpServerStatus.ACTIVE),
              eq(mcpServersTable.status, McpServerStatus.INACTIVE)
            )
      )
    )
    .orderBy(desc(mcpServersTable.created_at));

  return servers as McpServer[];
}

export async function getMcpServerByUuid(
  profileUuid: string,
  uuid: string
): Promise<McpServer | undefined> {
  const server = await db.query.mcpServersTable.findFirst({
    where: and(
      eq(mcpServersTable.uuid, uuid),
      eq(mcpServersTable.profile_uuid, profileUuid)
    ),
  });
  return server;
}

export async function deleteMcpServerByUuid(
  profileUuid: string,
  uuid: string
): Promise<void> {
  await db
    .delete(mcpServersTable)
    .where(
      and(
        eq(mcpServersTable.uuid, uuid),
        eq(mcpServersTable.profile_uuid, profileUuid)
      )
    );
}

export async function toggleMcpServerStatus(
  profileUuid: string,
  uuid: string,
  newStatus: McpServerStatus
): Promise<void> {
  await db
    .update(mcpServersTable)
    .set({ status: newStatus })
    .where(
      and(
        eq(mcpServersTable.uuid, uuid),
        eq(mcpServersTable.profile_uuid, profileUuid)
      )
    );
}

export async function updateMcpServer(
  profileUuid: string,
  uuid: string,
  data: {
    name?: string;
    description?: string;
    command?: string;
    args?: string[];
    env?: { [key: string]: string };
    url?: string;
    type?: McpServerType;
  }
): Promise<void> {
  await db
    .update(mcpServersTable)
    .set({
      ...data,
    })
    .where(
      and(
        eq(mcpServersTable.uuid, uuid),
        eq(mcpServersTable.profile_uuid, profileUuid)
      )
    );
}

export async function createMcpServer(
  profileUuid: string,
  data: {
    name: string;
    description: string;
    command?: string;
    args: string[];
    env: { [key: string]: string };
    url?: string;
    type?: McpServerType;
  }
): Promise<void> {
  await db.insert(mcpServersTable).values({
    ...data,
    profile_uuid: profileUuid,
  });
}

export async function bulkImportMcpServers(
  data: {
    mcpServers: {
      [name: string]: {
        command?: string;
        args?: string[];
        env?: { [key: string]: string };
        description?: string;
        url?: string;
        type?: McpServerType;
      };
    };
  },
  profileUuid?: string | null
) {
  if (!profileUuid) {
    throw new Error('Current workspace not found');
  }

  const { mcpServers } = data;

  const serverEntries = Object.entries(mcpServers);

  for (const [name, serverConfig] of serverEntries) {
    const serverData = {
      name,
      description: serverConfig.description || '',
      command: serverConfig.command || null,
      args: serverConfig.args || [],
      env: serverConfig.env || {},
      url: serverConfig.url || null,
      type: serverConfig.type || McpServerType.STDIO,
      profile_uuid: profileUuid,
      status: McpServerStatus.ACTIVE,
    };

    // Insert the server into the database
    await db.insert(mcpServersTable).values(serverData);
  }

  return { success: true, count: serverEntries.length };
}
