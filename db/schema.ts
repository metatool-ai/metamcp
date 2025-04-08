import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  index,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { enumToPgEnum } from './utils/enum-to-pg-enum';

export enum McpServerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUGGESTED = 'SUGGESTED',
  DECLINED = 'DECLINED',
}

export enum ToggleStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum McpServerType {
  STDIO = 'STDIO',
  SSE = 'SSE',
}

export enum ProfileCapability {
  TOOLS_MANAGEMENT = 'TOOLS_MANAGEMENT',
  TOOL_LOGS = 'TOOL_LOGS',
}

export enum ToolExecutionStatus {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  PENDING = 'PENDING',
}

export const mcpServerStatusEnum = pgEnum(
  'mcp_server_status',
  enumToPgEnum(McpServerStatus)
);

export const toggleStatusEnum = pgEnum(
  'toggle_status',
  enumToPgEnum(ToggleStatus)
);

export const mcpServerTypeEnum = pgEnum(
  'mcp_server_type',
  enumToPgEnum(McpServerType)
);

export const profileCapabilityEnum = pgEnum(
  'profile_capability',
  enumToPgEnum(ProfileCapability)
);

export const toolExecutionStatusEnum = pgEnum(
  'tool_execution_status',
  enumToPgEnum(ToolExecutionStatus)
);

export const projectsTable = pgTable('projects', {
  uuid: uuid('uuid').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  active_profile_uuid: uuid('active_profile_uuid').references(
    (): AnyPgColumn => {
      return profilesTable.uuid;
    }
  ),
});

export const profilesTable = pgTable(
  'profiles',
  {
    uuid: uuid('uuid').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    project_uuid: uuid('project_uuid')
      .notNull()
      .references(() => projectsTable.uuid, { onDelete: 'cascade' }),
    enabled_capabilities: profileCapabilityEnum('enabled_capabilities')
      .array()
      .notNull()
      .default(sql`'{}'::profile_capability[]`),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('profiles_project_uuid_idx').on(table.project_uuid)]
);

export const apiKeysTable = pgTable(
  'api_keys',
  {
    uuid: uuid('uuid').primaryKey().defaultRandom(),
    project_uuid: uuid('project_uuid')
      .notNull()
      .references(() => projectsTable.uuid, { onDelete: 'cascade' }),
    api_key: text('api_key').notNull(),
    name: text('name').default('API Key'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('api_keys_project_uuid_idx').on(table.project_uuid)]
);

export const mcpServersTable = pgTable(
  'mcp_servers',
  {
    uuid: uuid('uuid').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    type: mcpServerTypeEnum('type').notNull().default(McpServerType.STDIO),
    command: text('command'),
    args: text('args')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    env: jsonb('env')
      .$type<{ [key: string]: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    url: text('url'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    profile_uuid: uuid('profile_uuid')
      .notNull()
      .references(() => profilesTable.uuid),
    status: mcpServerStatusEnum('status')
      .notNull()
      .default(McpServerStatus.ACTIVE),
  },
  (table) => [
    index('mcp_servers_status_idx').on(table.status),
    index('mcp_servers_profile_uuid_idx').on(table.profile_uuid),
    index('mcp_servers_type_idx').on(table.type),
    sql`CONSTRAINT mcp_servers_url_check CHECK (
      (type = 'SSE' AND url IS NOT NULL AND command IS NULL AND url ~ '^https?://[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(:[0-9]+)?(/[a-zA-Z0-9-._~:/?#\[\]@!$&''()*+,;=]*)?$') OR
      (type = 'STDIO' AND url IS NULL AND command IS NOT NULL)
    )`,
  ]
);

export const codesTable = pgTable('codes', {
  uuid: uuid('uuid').primaryKey().defaultRandom(),
  fileName: text('file_name').notNull(),
  code: text('code').notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customMcpServersTable = pgTable(
  'custom_mcp_servers',
  {
    uuid: uuid('uuid').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    code_uuid: uuid('code_uuid')
      .notNull()
      .references(() => codesTable.uuid),
    additionalArgs: text('additional_args')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    env: jsonb('env')
      .$type<{ [key: string]: string }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    profile_uuid: uuid('profile_uuid')
      .notNull()
      .references(() => profilesTable.uuid),
    status: mcpServerStatusEnum('status')
      .notNull()
      .default(McpServerStatus.ACTIVE),
  },
  (table) => [
    index('custom_mcp_servers_status_idx').on(table.status),
    index('custom_mcp_servers_profile_uuid_idx').on(table.profile_uuid),
  ]
);

export const toolsTable = pgTable(
  'tools',
  {
    uuid: uuid('uuid').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    toolSchema: jsonb('tool_schema')
      .$type<{
        type: 'object';
        properties?: Record<string, any>;
      }>()
      .notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    mcp_server_uuid: uuid('mcp_server_uuid')
      .notNull()
      .references(() => mcpServersTable.uuid, { onDelete: 'cascade' }),
    status: toggleStatusEnum('status').notNull().default(ToggleStatus.ACTIVE),
  },
  (table) => [
    index('tools_mcp_server_uuid_idx').on(table.mcp_server_uuid),
    unique('tools_unique_tool_name_per_server_idx').on(
      table.mcp_server_uuid,
      table.name
    ),
  ]
);

export const toolExecutionLogsTable = pgTable(
  'tool_execution_logs',
  {
    id: serial('id').primaryKey(),
    mcp_server_uuid: uuid('mcp_server_uuid').references(
      () => mcpServersTable.uuid,
      { onDelete: 'no action' }
    ),
    tool_name: text('tool_name').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, any>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result').$type<any>(),
    status: toolExecutionStatusEnum('status')
      .notNull()
      .default(ToolExecutionStatus.PENDING),
    error_message: text('error_message'),
    execution_time_ms: text('execution_time_ms'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('tool_execution_logs_mcp_server_uuid_idx').on(table.mcp_server_uuid),
    index('tool_execution_logs_tool_name_idx').on(table.tool_name),
    index('tool_execution_logs_created_at_idx').on(table.created_at),
  ]
);
