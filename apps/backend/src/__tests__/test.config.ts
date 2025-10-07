/**
 * Test configuration following testing best practices
 * Centralized configuration improves maintainability
 */

export const TEST_CONFIG = {
  // Default timeout for all tests
  DEFAULT_TIMEOUT: 10000,

  // Timeout for fast unit tests
  FAST_TIMEOUT: 1000,

  // Timeout for integration tests
  INTEGRATION_TIMEOUT: 15000,

  // Timeout for tests involving external services
  EXTERNAL_SERVICE_TIMEOUT: 20000,

  // Number of retry attempts for flaky tests
  RETRY_COUNT: 2,

  // Test data limits
  MAX_TEST_ITERATIONS: 100,
  MIN_TEST_ITERATIONS: 10,

  // Performance thresholds
  PERFORMANCE: {
    MAX_TOKEN_GENERATION_TIME: 10, // ms
    MAX_VALIDATION_TIME: 50, // ms
    MAX_DATABASE_OPERATION_TIME: 100 // ms
  },

  // Coverage thresholds (should match vitest.config.ts)
  COVERAGE: {
    LINES: 80,
    FUNCTIONS: 80,
    BRANCHES: 75,
    STATEMENTS: 80
  }
} as const

/**
 * Test environment setup utilities
 */
export class TestEnvironment {
  static isCI(): boolean {
    return !!process.env.CI
  }

  static getTestTimeout(testType: 'unit' | 'integration' | 'external' = 'unit'): number {
    const timeouts = {
      unit: TEST_CONFIG.FAST_TIMEOUT,
      integration: TEST_CONFIG.INTEGRATION_TIMEOUT,
      external: TEST_CONFIG.EXTERNAL_SERVICE_TIMEOUT
    }

    // Increase timeouts in CI environment
    const multiplier = this.isCI() ? 2 : 1
    return timeouts[testType] * multiplier
  }

  static shouldSkipSlowTests(): boolean {
    return process.env.SKIP_SLOW_TESTS === 'true'
  }

  static shouldRunOnlyFast(): boolean {
    return process.env.FAST_TESTS_ONLY === 'true'
  }
}

/**
 * Test annotations for better test categorization
 */
export const TestTags = {
  UNIT: 'unit',
  INTEGRATION: 'integration',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  FLAKY: 'flaky',
  SLOW: 'slow'
} as const

/**
 * Common test patterns
 */
export const TestPatterns = {
  // Common regex patterns for validation
  JWT_PATTERN: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,

  // OAuth token patterns
  ACCESS_TOKEN_PATTERN: /^mcp_token_[A-Za-z0-9_-]+$/,
  AUTH_CODE_PATTERN: /^mcp_code_[A-Za-z0-9_-]+$/,
  CLIENT_ID_PATTERN: /^mcp_client_[A-Za-z0-9_-]+$/
} as const