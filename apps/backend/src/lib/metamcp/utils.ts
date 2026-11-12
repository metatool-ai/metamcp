import { DatabaseMcpServer, ServerParameters } from "@repo/zod-types";

import logger from "@/utils/logger";

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
      [
        "HOME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TERM",
        "USER",
        // SSL/Certificate variables for corporate proxies and custom CA certificates
        "NODE_EXTRA_CA_CERTS",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "SSL_CERT_FILE",
        "CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "REQUESTS_CERT_FILE",
        "CURL_CA_BUNDLE",
        "PIP_CERT",
        "UV_CERT",
        "PYTHONHTTPSVERIFY",
        // Proxy variables
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ];

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
      headers: server.headers || {},
      forward_headers: server.forward_headers || {},
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
        logger.warn(
          `${params.type} server ${params.uuid} is missing url field, skipping`,
        );
        return null;
      }
    }

    return params;
  } catch (error) {
    logger.error(
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
// Env values flow from process.env (string | undefined) through the loosely-typed
// stdio spawn chain (createStdioKey/isStdioInCooldown/ProcessManagedStdioTransport),
// so this stays intentionally permissive; tightening it cascades through that chain.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EnvRecord = Record<string, any>;

/**
 * Backend environment variables that must never be copied into a STDIO MCP
 * server through a "${VAR}" placeholder: they hold MetaMCP's own secrets
 * (database credentials, auth signing secret, OIDC client secret, bootstrap
 * passwords). Users can read their server's environment back, so resolving
 * these would hand them to any user who can create a STDIO server.
 */
const PROTECTED_ENV_VAR_PATTERNS: RegExp[] = [
  /^DATABASE_URL$/,
  /^POSTGRES_/,
  /^PG[A-Z]*$/,
  /^BETTER_AUTH_/,
  /^OIDC_/,
  /^BOOTSTRAP_/,
  /^METAMCP_ADMIN_EMAILS$/,
];

/**
 * Environment variable names a STDIO server config may not set, because they
 * let the configured value inject code into the spawned runtime (dynamic
 * loader preloads, Node/Python startup hooks) rather than configure the tool.
 */
const FORBIDDEN_CHILD_ENV_PATTERNS: RegExp[] = [
  /^LD_/,
  /^DYLD_/,
  /^NODE_OPTIONS$/,
  /^NODE_PATH$/,
  /^PYTHONSTARTUP$/,
  /^PYTHONPATH$/,
  /^PERL5OPT$/,
  /^RUBYOPT$/,
  /^BASH_ENV$/,
  /^ENV$/,
];

export function isProtectedEnvVar(name: string): boolean {
  return PROTECTED_ENV_VAR_PATTERNS.some((re) => re.test(name));
}

export function isForbiddenChildEnvVar(name: string): boolean {
  return FORBIDDEN_CHILD_ENV_PATTERNS.some((re) => re.test(name.toUpperCase()));
}

export function resolveEnvVariables(envObject: EnvRecord): EnvRecord {
  const resolved: EnvRecord = {};

  for (const [key, value] of Object.entries(envObject)) {
    if (isForbiddenChildEnvVar(key)) {
      logger.warn(
        `Ignoring forbidden environment variable for MCP server process: ${key}`,
      );
      continue;
    }

    if (
      typeof value === "string" &&
      value.startsWith("${") &&
      value.endsWith("}")
    ) {
      const varName = value.slice(2, -1);
      if (isProtectedEnvVar(varName)) {
        resolved[key] = value;
        logger.warn(
          `Refusing to resolve protected environment variable ${varName} for ${key}; keeping placeholder`,
        );
        continue;
      }
      const envValue = process.env[varName];
      if (envValue) {
        resolved[key] = envValue;
        logger.info(
          `Resolved environment variable: ${key}=${value} -> ${varName}=[REDACTED]`,
        );
      } else {
        resolved[key] = value; // Keep original value if env var not found
        logger.warn(
          `Environment variable not found: ${varName}, keeping original value: ${value}`,
        );
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}
