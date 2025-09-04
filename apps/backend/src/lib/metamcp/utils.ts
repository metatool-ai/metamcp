import { DatabaseMcpServer, ServerParameters } from "@repo/zod-types";

import { oauthSessionsRepository } from "../../db/repositories/oauth-sessions.repo";

/**
 * Environment variables to inherit by default, if an environment is not explicitly given.
 */
export const DEFAULT_INHERITED_ENV_VARS =
  process.platform === "win32"
    ? [
        "APPDATA",
        "HOMEDRIVE",
        "HOMEPATH",
        "LOCALAPPDATA",
        "PATH",
        "PROCESSOR_ARCHITECTURE",
        "SYSTEMDRIVE",
        "SYSTEMROOT",
        "TEMP",
        "USERNAME",
        "USERPROFILE",
      ]
    : /* list inspired by the default env inheritance of sudo */
      ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

/**
 * Returns a default environment object including only environment variables deemed safe to inherit.
 */
export function getDefaultEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined) {
      continue;
    }

    if (value.startsWith("()")) {
      // Skip functions, which are a security risk.
      continue;
    }

    env[key] = value;
  }

  return env;
}

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Converts a database MCP server record to ServerParameters format
 * @param server Database MCP server record
 * @returns ServerParameters object or null if conversion fails
 */
export async function convertDbServerToParams(
  server: DatabaseMcpServer,
): Promise<ServerParameters | null> {
  try {
    // Fetch OAuth tokens from OAuth sessions table
    const oauthSession = await oauthSessionsRepository.findByMcpServerUuid(
      server.uuid,
    );
    let oauthTokens = null;

    if (oauthSession && oauthSession.tokens) {
      oauthTokens = {
        access_token: oauthSession.tokens.access_token,
        token_type: oauthSession.tokens.token_type,
        expires_in: oauthSession.tokens.expires_in,
        scope: oauthSession.tokens.scope,
        refresh_token: oauthSession.tokens.refresh_token,
      };
    }

    const params: ServerParameters = {
      uuid: server.uuid,
      name: server.name,
      description: server.description || "",
      type: server.type || "STDIO",
      command: server.command,
      args: server.args || [],
      env: server.env || {},
      url: server.url,
      created_at: server.created_at?.toISOString() || new Date().toISOString(),
      status: "active", // Default status for non-namespace servers
      stderr: "inherit" as const,
      oauth_tokens: oauthTokens,
      bearerToken: server.bearerToken,
    };

    // Process based on server type
    if (params.type === "STDIO") {
      if ("args" in params && !params.args) {
        params.args = undefined;
      }

      params.env = {
        ...getDefaultEnvironment(),
        ...(params.env || {}),
      };
    } else if (params.type === "SSE" || params.type === "STREAMABLE_HTTP") {
      // For SSE or STREAMABLE_HTTP servers, ensure url is present
      if (!params.url) {
        console.warn(
          `${params.type} server ${params.uuid} is missing url field, skipping`,
        );
        return null;
      }
    }

    return params;
  } catch (error) {
    console.error(
      `Error converting server ${server.uuid} to parameters:`,
      error,
    );
    return null;
  }
}

/**
 * Resolves environment variable placeholders in an environment object.
 * Replaces values like "${VAR_NAME}" with the actual environment variable value.
 * @param envObject Environment object that may contain placeholder values
 * @returns Environment object with resolved values
 */
export function resolveEnvVariables(
  envObject: Record<string, any>,
): Record<string, any> {
  const resolved: Record<string, any> = {};

  for (const [key, value] of Object.entries(envObject)) {
    if (
      typeof value === "string" &&
      value.startsWith("${") &&
      value.endsWith("}")
    ) {
      const varName = value.slice(2, -1);
      if (process.env[varName]) {
        resolved[key] = process.env[varName];
        console.log(
          `Resolved environment variable: ${key}=${value} -> ${varName}=[REDACTED]`,
        );
      } else {
        resolved[key] = value; // Keep original value if env var not found
        console.warn(
          `Environment variable not found: ${varName}, keeping original value: ${value}`,
        );
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}
