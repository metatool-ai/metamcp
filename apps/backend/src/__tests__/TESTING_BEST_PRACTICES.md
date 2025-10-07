# Testing Best Practices

This document outlines the testing best practices followed in the OAuth 2.0 Token Exchange test suite.

## 🎯 Testing Philosophy

### Test Pyramid Structure
- **Unit Tests (60%)**: Fast, isolated, test individual functions
- **Integration Tests (30%)**: Test component interactions
- **End-to-End Tests (10%)**: Test complete user journeys

### Key Principles
1. **Fast Feedback**: Tests should run quickly for rapid development
2. **Reliable**: Tests should not be flaky or dependent on external factors
3. **Readable**: Tests should be clear documentation of expected behavior
4. **Maintainable**: Easy to update when requirements change

## 📁 Test Organization

### Directory Structure
```
src/__tests__/
├── constants/          # Centralized test constants
├── helpers/           # Reusable test utilities
├── mocks/             # External service mocks
├── unit/              # Unit tests (isolated functions)
├── integration/       # Integration tests (component interaction)
└── config/            # Test configuration
```

### File Naming Conventions
- `*.test.ts` - Test files
- `*.mock.ts` - Mock implementations
- `*.factory.ts` - Test data factories
- `*.config.ts` - Configuration files

## ✅ Writing Good Tests

### Test Structure (AAA Pattern)
```typescript
describe('Feature Name', () => {
  it('should do something when condition is met', () => {
    // Arrange - Set up test data and conditions
    const input = createTestData()

    // Act - Execute the functionality being tested
    const result = functionUnderTest(input)

    // Assert - Verify the expected outcome
    expect(result).toBe(expectedValue)
  })
})
```

### Test Naming
- Use descriptive names that explain the scenario
- Format: `should [expected behavior] when [condition]`
- Good: `should generate unique tokens when called multiple times`
- Bad: `test token generation`

### Test Independence
```typescript
// ✅ Good - Each test is independent
beforeEach(() => {
  vi.clearAllMocks()
  resetTestState()
})

// ❌ Bad - Tests depend on execution order
let sharedState = {}
```

## 🔧 Test Utilities

### Custom Assertions
```typescript
import { assertSecureToken, assertOAuthError } from '../helpers/test-utils'

// Use domain-specific assertions
assertSecureToken(token, 'mcp_token')
assertOAuthError(response, 'invalid_grant')
```

### Test Data Builders
```typescript
import { TestDataBuilder } from '../helpers/test-utils'

const request = TestDataBuilder.tokenExchangeRequest({
  subject_token: 'custom_token'
})
```

### Constants Usage
```typescript
import { OAUTH_CONSTANTS, SECURITY_PAYLOADS } from '../constants/test-constants'

// Use centralized constants instead of magic strings
expect(response.grant_type).toBe(OAUTH_CONSTANTS.GRANT_TYPES.TOKEN_EXCHANGE)
```

## 🔒 Security Testing

### Input Validation Testing
```typescript
describe('Security Validation', () => {
  it.each(SECURITY_PAYLOADS.SQL_INJECTION)(
    'should prevent SQL injection with payload: %s',
    (payload) => {
      expect(() => validateInput(payload)).not.toThrow()
    }
  )
})
```

### Error Message Testing
```typescript
it('should not leak sensitive information in error messages', () => {
  const error = handleInvalidRequest(maliciousInput)

  expect(error.message).not.toContain('database')
  expect(error.message).not.toContain('password')
  expect(error.message).not.toContain('secret')
})
```

## 🎭 Mocking Best Practices

### External Services
```typescript
// ✅ Use MSW for HTTP service mocking
import { server } from '../mocks/supabase.mock'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

### Database Operations
```typescript
// ✅ Mock at the appropriate level
vi.mock('../db/repositories', () => ({
  usersRepository: {
    upsert: vi.fn(),
    getById: vi.fn()
  }
}))
```

### Console Mocking
```typescript
// ✅ Clean console mocking with utilities
const { mocks, restore } = mockConsole()

// Test that doesn't pollute console
expect(mocks.error).toHaveBeenCalledWith('Expected error message')

restore() // Clean up
```

## 📊 Performance Testing

### Response Time Validation
```typescript
it('should generate tokens within performance threshold', () => {
  const start = performance.now()
  const token = generateSecureAccessToken()
  const end = performance.now()

  expect(end - start).toBeLessThan(TEST_CONFIG.PERFORMANCE.MAX_TOKEN_GENERATION_TIME)
  expect(token).toBeTruthy()
})
```

### Memory Leak Detection
```typescript
it('should not leak memory during bulk operations', () => {
  const initialMemory = process.memoryUsage().heapUsed

  // Perform bulk operations
  Array.from({ length: 1000 }, () => generateSecureAccessToken())

  // Force garbage collection in test environment
  if (global.gc) global.gc()

  const finalMemory = process.memoryUsage().heapUsed
  const memoryIncrease = finalMemory - initialMemory

  // Memory increase should be reasonable
  expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024) // 50MB
})
```

## 🔄 Test Lifecycle

### Setup and Teardown
```typescript
describe('Feature Tests', () => {
  beforeAll(() => {
    // One-time setup for all tests
    setupTestEnvironment()
  })

  beforeEach(() => {
    // Setup before each test
    vi.clearAllMocks()
    resetTestState()
  })

  afterEach(() => {
    // Cleanup after each test
    cleanupTestData()
  })

  afterAll(() => {
    // One-time cleanup
    teardownTestEnvironment()
  })
})
```

## 📈 Coverage Guidelines

### Coverage Targets
- **Lines**: 80% minimum
- **Functions**: 80% minimum
- **Branches**: 75% minimum
- **Statements**: 80% minimum

### What to Focus On
1. **Critical Security Functions**: Aim for 95%+ coverage
2. **Business Logic**: Comprehensive test coverage
3. **Error Handling**: Test all error paths
4. **Edge Cases**: Boundary conditions and invalid inputs

### What Not to Over-Test
- Simple getters/setters
- Third-party library wrapper functions
- Configuration constants

## 🐛 Debugging Tests

### Test Debugging
```typescript
// Use test-specific logging
import { debug } from '../helpers/test-utils'

it('should handle complex scenario', () => {
  debug('Testing complex scenario with input:', input)

  const result = complexFunction(input)

  debug('Result received:', result)
  expect(result).toBe(expected)
})
```

### Isolation Testing
```typescript
// Run single test for debugging
it.only('should debug this specific case', () => {
  // Test code here
})

// Skip problematic tests temporarily
it.skip('should fix this later', () => {
  // Test code here
})
```

## 🚀 Continuous Improvement

### Test Metrics to Track
- Test execution time
- Test reliability (flakiness)
- Coverage percentage
- Code complexity in tested functions

### Regular Reviews
- Remove duplicate test scenarios
- Consolidate similar test utilities
- Update test data to reflect real-world scenarios
- Refactor tests for better readability

### Tools Integration
- Pre-commit hooks for test execution
- CI/CD integration with coverage reporting
- Automated test result analysis
- Performance regression detection

## 📚 Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library Best Practices](https://testing-library.com/docs/guiding-principles)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [OAuth 2.1 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)