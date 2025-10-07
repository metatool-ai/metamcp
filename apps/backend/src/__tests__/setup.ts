import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { server } from './mocks/supabase.mock'

// Setup MSW server for API mocking
beforeAll(() => {
  server.listen({
    onUnhandledRequest: 'error'
  })
})

afterEach(() => {
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})

// Global test setup - set test environment variables
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.SUPABASE_URL = 'https://test-project.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.DATABASE_URL = 'test-database-url'
})

// Clean up state between tests
beforeEach(() => {
  // Reset console spy mocks
  vi.clearAllMocks()
})