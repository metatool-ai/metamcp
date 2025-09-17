import { expect, vi } from 'vitest'

/**
 * Test utilities following testing best practices
 */

/**
 * Assert that a function throws an error with specific message
 */
export function expectToThrow(fn: () => any, expectedMessage?: string) {
  try {
    fn()
    throw new Error('Expected function to throw')
  } catch (error) {
    if (expectedMessage) {
      expect(error.message).toContain(expectedMessage)
    }
    expect(error).toBeInstanceOf(Error)
  }
}

/**
 * Assert that an async function rejects with specific error
 */
export async function expectToReject(
  promise: Promise<any>,
  expectedMessage?: string
) {
  try {
    await promise
    throw new Error('Expected promise to reject')
  } catch (error) {
    if (expectedMessage) {
      expect(error.message).toContain(expectedMessage)
    }
    expect(error).toBeInstanceOf(Error)
  }
}

/**
 * Create a delay for testing async operations
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Generate test timestamp in consistent format
 */
export const testTimestamp = () => new Date('2023-01-01T00:00:00.000Z')

/**
 * Validate OAuth error response format
 */
export function assertOAuthError(
  response: any,
  expectedError: string,
  expectedDescription?: string
) {
  expect(response).toHaveProperty('error')
  expect(response).toHaveProperty('error_description')
  expect(response.error).toBe(expectedError)

  if (expectedDescription) {
    expect(response.error_description).toContain(expectedDescription)
  }

  expect(typeof response.error).toBe('string')
  expect(typeof response.error_description).toBe('string')
}

/**
 * Validate OAuth success response format
 */
export function assertOAuthSuccess(response: any) {
  expect(response).toHaveProperty('access_token')
  expect(response).toHaveProperty('token_type')
  expect(response).toHaveProperty('expires_in')

  expect(response.access_token).toMatch(/^mcp_token_/)
  expect(response.token_type).toBe('Bearer')
  expect(typeof response.expires_in).toBe('number')
  expect(response.expires_in).toBeGreaterThan(0)
}

/**
 * Assert token format matches security requirements
 */
export function assertSecureToken(token: string, expectedPrefix: string) {
  expect(token).toMatch(new RegExp(`^${expectedPrefix}_[A-Za-z0-9_-]+$`))
  expect(token.length).toBeGreaterThan(expectedPrefix.length + 10)
}

/**
 * Mock console methods cleanly
 */
export function mockConsole() {
  const consoleMock = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }

  Object.keys(consoleMock).forEach(method => {
    vi.spyOn(console, method as keyof Console).mockImplementation(consoleMock[method])
  })

  return {
    mocks: consoleMock,
    restore: () => {
      Object.keys(consoleMock).forEach(method => {
        vi.mocked(console[method as keyof Console]).mockRestore()
      })
    }
  }
}

/**
 * Test data builders for better readability
 */
export class TestDataBuilder {
  static tokenExchangeRequest(overrides = {}) {
    return {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'valid_jwt_token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      client_id: 'test_client',
      ...overrides
    }
  }

  static oauthErrorResponse(error: string, description: string) {
    return {
      error,
      error_description: description
    }
  }

  static oauthSuccessResponse(token = 'mcp_token_test123') {
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'admin'
    }
  }
}