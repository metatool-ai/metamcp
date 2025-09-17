# OAuth 2.0 Token Exchange Test Suite

This directory contains comprehensive automated tests for the OAuth 2.0 Token Exchange feature implemented in MetaMCP.

## Test Coverage

### Unit Tests (`unit/`)

#### OAuth Utils (`oauth-utils.test.ts`)
- **Token Generation**: Secure random token generation with proper prefixes
- **JWT Validation**: Supabase JWT validation with error handling
- **Redirect URI Validation**: Security validation for OAuth redirects
- **Client Secret Hashing**: Secure hashing and verification
- **Rate Limiting**: Basic rate limiting functionality

#### Repository Tests (`repositories.test.ts`)
- **User Data Validation**: User creation and upsert logic
- **OAuth Client Configuration**: Client setup and validation
- **Token Data Structure**: Access token format validation
- **Data Consistency**: Cross-reference validation

### Integration Tests (`integration/`)

#### Token Exchange (`token-exchange.test.ts`)
- **Parameter Validation**: RFC 8693 compliance testing
- **User Management**: Auto-creation and account linking
- **Client Management**: Default client setup
- **Token Generation**: Format and expiration validation
- **Error Handling**: Proper OAuth error responses
- **Content-Type Support**: JSON and form-encoded requests

#### Security & Edge Cases (`security-edge-cases.test.ts`)
- **Input Validation**: SQL injection and XSS prevention
- **Authentication Security**: JWT structure validation
- **Error Handling**: Information disclosure prevention
- **Data Validation**: Parameter sanitization
- **Rate Limiting**: DoS protection logic
- **Concurrent Access**: Race condition handling

## Test Infrastructure

### Frameworks Used
- **Vitest**: Modern TypeScript-native testing framework
- **MSW**: HTTP request mocking for Supabase integration
- **Supertest**: HTTP endpoint testing (planned for full integration)

### Mock Setup
- **Supabase API**: Complete JWT validation endpoint mocking
- **Database**: In-memory SQLite for repository tests
- **Test Factories**: Consistent test data generation

### Test Data Factories (`factories/`)
- **User Factory**: Test user creation with various scenarios
- **OAuth Factory**: Client and token test data generation

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in CI mode (single run)
pnpm test:run

# Generate coverage report
pnpm test:coverage

# Run tests in watch mode during development
pnpm test
```

## Coverage Goals

- **OAuth Utils**: >95% (security-critical functions)
- **Token Exchange Logic**: >90% (main feature)
- **Integration Flows**: 100% major user journeys

## Security Testing

Following OWASP best practices, the test suite includes:

### Input Validation
- SQL injection prevention
- XSS payload handling
- Boundary value testing
- Unicode and special character handling

### Authentication Security
- JWT signature validation
- Token replay prevention
- Invalid token structure detection

### Error Handling
- Information disclosure prevention
- Generic error messages
- Consistent OAuth error format

## Test Scenarios Covered

### Happy Path
- ✅ Valid Supabase JWT → MCP token exchange
- ✅ User auto-creation from external provider
- ✅ Default OAuth client setup
- ✅ RFC 8693 compliant responses

### Error Cases
- ✅ Invalid JWT rejection
- ✅ Missing required parameters
- ✅ Network failures (Supabase downtime)
- ✅ Database constraint violations
- ✅ Malformed request handling

### Edge Cases
- ✅ Concurrent user creation
- ✅ Account linking by email
- ✅ Users without email addresses
- ✅ Rate limiting enforcement
- ✅ Content-type variations

### Security Tests
- ✅ SQL injection attempts
- ✅ XSS payload prevention
- ✅ JWT bypass attempts
- ✅ Oversized payload handling
- ✅ Input boundary validation

## Test Organization

```
src/__tests__/
├── setup.ts                 # Global test configuration
├── factories/               # Test data generation
│   ├── user.factory.ts     # User test data
│   └── oauth.factory.ts    # OAuth test data
├── mocks/                  # External service mocking
│   └── supabase.mock.ts    # Supabase API mock
├── helpers/                # Test utilities
│   └── test-db.ts         # Database test setup
├── unit/                   # Unit tests
│   ├── oauth-utils.test.ts # OAuth utility functions
│   └── repositories.test.ts # Data layer tests
└── integration/            # Integration tests
    ├── token-exchange.test.ts     # Main feature tests
    └── security-edge-cases.test.ts # Security validation
```

## Implementation Notes

### Simplified Approach
The test suite prioritizes:
- **Correctness over complexity**: Focus on core business logic
- **Security validation**: Comprehensive security testing
- **Maintainability**: Clear, readable test code
- **Fast execution**: Optimized for development workflow

### Design Decisions
- **Mock over Real DBs**: In-memory SQLite for speed
- **Logic over HTTP**: Unit tests focus on business logic
- **Security-first**: Comprehensive OWASP coverage
- **RFC Compliance**: Strict OAuth 2.0 standard adherence

## Future Enhancements

1. **Performance Testing**: Load testing for token exchange
2. **Full HTTP Integration**: End-to-end API testing
3. **Database Integration**: Real PostgreSQL testing
4. **CI/CD Integration**: Automated test reporting
5. **Mutation Testing**: Test quality validation

## Contributing

When adding new OAuth functionality:

1. **Add Unit Tests**: For utility functions and business logic
2. **Add Integration Tests**: For complete user flows
3. **Add Security Tests**: For any new input validation
4. **Update Factories**: Maintain test data consistency
5. **Document Edge Cases**: Include edge case scenarios

All tests must pass before merging new OAuth features.