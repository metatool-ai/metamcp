import { UserCreateInput, DatabaseUser } from '../../db/repositories/users.repo'

export const createTestUser = (overrides: Partial<UserCreateInput> = {}): UserCreateInput => {
  return {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    image: null,
    ...overrides
  }
}

export const createDatabaseUser = (overrides: Partial<DatabaseUser> = {}): DatabaseUser => {
  return {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
    ...overrides
  }
}

// Common test user scenarios
export const testUsers = {
  standard: createTestUser(),
  noEmail: createTestUser({
    id: 'user-no-email',
    email: 'user-no-email@oauth.local'
  }),
  unverifiedEmail: createTestUser({
    id: 'user-unverified',
    emailVerified: false
  }),
  withImage: createTestUser({
    id: 'user-with-image',
    image: 'https://example.com/avatar.jpg'
  }),
  existingByEmail: createTestUser({
    id: 'different-external-id',
    email: 'existing@example.com'
  }),
}