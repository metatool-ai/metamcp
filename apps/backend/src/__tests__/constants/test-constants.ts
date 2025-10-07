/**
 * Test constants following testing best practices
 * Centralized constants improve maintainability and consistency
 */

// OAuth 2.0 Constants
export const OAUTH_CONSTANTS = {
  GRANT_TYPES: {
    TOKEN_EXCHANGE: 'urn:ietf:params:oauth:grant-type:token-exchange',
    AUTHORIZATION_CODE: 'authorization_code'
  },
  TOKEN_TYPES: {
    ACCESS_TOKEN: 'urn:ietf:params:oauth:token-type:access_token',
    REFRESH_TOKEN: 'urn:ietf:params:oauth:token-type:refresh_token'
  },
  TOKEN_PREFIXES: {
    ACCESS: 'mcp_token_',
    AUTH_CODE: 'mcp_code_',
    CLIENT: 'mcp_client_',
    SECRET: 'mcp_secret_'
  },
  ERROR_CODES: {
    INVALID_REQUEST: 'invalid_request',
    INVALID_GRANT: 'invalid_grant',
    UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
    SERVER_ERROR: 'server_error'
  },
  DEFAULT_CLIENT_ID: 'mcp_default',
  DEFAULT_SCOPE: 'admin',
  TOKEN_EXPIRY_SECONDS: 3600
} as const

// Test User Constants
export const TEST_USERS = {
  STANDARD: {
    id: 'test-user-standard',
    email: 'standard@example.com',
    name: 'Standard User'
  },
  NO_EMAIL: {
    id: 'test-user-no-email',
    name: 'No Email User'
  },
  EXISTING: {
    id: 'test-user-existing',
    email: 'existing@example.com',
    name: 'Existing User'
  }
} as const

// Security Test Constants
export const SECURITY_PAYLOADS = {
  SQL_INJECTION: [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "'; SELECT * FROM oauth_access_tokens; --",
    "' UNION SELECT null, password FROM users --"
  ],
  XSS_PAYLOADS: [
    '<script>alert("xss")</script>',
    'javascript:alert(1)',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(document.cookie)</script>'
  ],
  INVALID_JWTS: [
    'invalid_single_string',
    'header.payload',
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.',
    ''
  ]
} as const

// Test Environment Constants
export const TEST_ENV = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  DATABASE_URL: 'test-database-url',
  NODE_ENV: 'test'
} as const

// Rate Limiting Constants
export const RATE_LIMIT = {
  MAX_REQUESTS: 20,
  TIME_WINDOW_MS: 60 * 1000, // 1 minute
  TEST_REQUEST_COUNT: 25
} as const

// Response Time Constants
export const RESPONSE_TIMES = {
  FAST_TEST_TIMEOUT: 2000,
  NETWORK_TIMEOUT: 100,
  MAX_PAYLOAD_SIZE: 10 * 1024 * 1024 // 10MB
} as const