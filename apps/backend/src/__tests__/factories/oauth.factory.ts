import {
  OAuthClientCreateInput,
  OAuthAccessTokenCreateInput,
  OAuthAuthorizationCodeCreateInput
} from '@repo/zod-types'

export const createTestOAuthClient = (overrides: Partial<OAuthClientCreateInput> = {}): OAuthClientCreateInput => {
  return {
    client_id: 'test_client_id',
    client_name: 'Test OAuth Client',
    client_secret: 'test_client_secret',
    redirect_uris: ['https://localhost:3000/callback'],
    grant_types: ['authorization_code', 'urn:ietf:params:oauth:grant-type:token-exchange'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'admin',
    ...overrides
  }
}

export const createTestAccessToken = (overrides: Partial<OAuthAccessTokenCreateInput> = {}): OAuthAccessTokenCreateInput => {
  return {
    client_id: 'test_client_id',
    user_id: 'test-user-id',
    scope: 'admin',
    expires_at: Date.now() + 3600 * 1000, // 1 hour from now
    ...overrides
  }
}

export const createTestAuthCode = (overrides: Partial<OAuthAuthorizationCodeCreateInput> = {}): OAuthAuthorizationCodeCreateInput => {
  return {
    client_id: 'test_client_id',
    redirect_uri: 'https://localhost:3000/callback',
    scope: 'admin',
    user_id: 'test-user-id',
    code_challenge: 'test_challenge',
    code_challenge_method: 'S256',
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes from now
    ...overrides
  }
}

// Common OAuth test scenarios
export const testOAuthScenarios = {
  defaultClient: createTestOAuthClient({
    client_id: 'mcp_default',
    client_name: 'MetaMCP Default Client'
  }),

  tokenExchangeClient: createTestOAuthClient({
    client_id: 'token_exchange_client',
    grant_types: ['urn:ietf:params:oauth:grant-type:token-exchange'],
    token_endpoint_auth_method: 'none'
  }),

  confidentialClient: createTestOAuthClient({
    client_id: 'confidential_client',
    token_endpoint_auth_method: 'client_secret_basic',
    client_secret: 'super_secret_client_secret'
  }),

  validAccessToken: createTestAccessToken(),

  expiredAccessToken: createTestAccessToken({
    expires_at: Date.now() - 1000 // Expired 1 second ago
  }),

  validAuthCode: createTestAuthCode(),

  expiredAuthCode: createTestAuthCode({
    expires_at: Date.now() - 1000 // Expired 1 second ago
  })
}