import * as schemaPg from "./schemas/schema-postgres"
import * as schemaSqlite from "./schemas/schema-sqlite";

const DATABASE_TYPE = process.env.DATABASE_TYPE;

// Dynamically select the appropriate schema based on database type
const selectedSchema = DATABASE_TYPE === "sqlite" ? schemaSqlite : schemaPg;

// Export all tables from the selected schema
export const mcpServersTable = selectedSchema.mcpServersTable;
export const oauthSessionsTable = selectedSchema.oauthSessionsTable;
export const toolsTable = selectedSchema.toolsTable;
export const usersTable = selectedSchema.usersTable;
export const sessionsTable = selectedSchema.sessionsTable;
export const accountsTable = selectedSchema.accountsTable;
export const verificationsTable = selectedSchema.verificationsTable;
export const namespacesTable = selectedSchema.namespacesTable;
export const endpointsTable = selectedSchema.endpointsTable;
export const namespaceServerMappingsTable = selectedSchema.namespaceServerMappingsTable;
export const namespaceToolMappingsTable = selectedSchema.namespaceToolMappingsTable;
export const apiKeysTable = selectedSchema.apiKeysTable;
export const configTable = selectedSchema.configTable;
export const oauthClientsTable = selectedSchema.oauthClientsTable;
export const oauthAuthorizationCodesTable = selectedSchema.oauthAuthorizationCodesTable;
export const oauthAccessTokensTable = selectedSchema.oauthAccessTokensTable;