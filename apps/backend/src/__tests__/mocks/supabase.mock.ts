import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Mock Supabase user validation endpoint
const handlers = [
  // Valid JWT token responses
  http.get('https://test-project.supabase.co/auth/v1/user', ({ request }) => {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    // Valid test tokens
    if (token === 'valid_jwt_token') {
      return HttpResponse.json({
        id: 'test-user-id-1',
        email: 'test@example.com',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      })
    }

    if (token === 'valid_jwt_no_email') {
      return HttpResponse.json({
        id: 'test-user-id-2',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      })
    }

    if (token === 'valid_jwt_different_user') {
      return HttpResponse.json({
        id: 'test-user-id-3',
        email: 'different@example.com',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      })
    }

    // Simulate network timeout
    if (token === 'timeout_token') {
      return new Promise(() => {
        // Never resolve to simulate timeout
      })
    }

    // Simulate server error
    if (token === 'server_error_token') {
      return HttpResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    // Simulate malformed response
    if (token === 'malformed_response_token') {
      return HttpResponse.text('invalid json response')
    }

    // Invalid tokens return 401
    return HttpResponse.json(
      { error: 'Invalid token' },
      { status: 401 }
    )
  }),
]

export const server = setupServer(...handlers)

// Helper functions for tests
export const mockSupabaseResponses = {
  validUser: {
    token: 'valid_jwt_token',
    user: { id: 'test-user-id-1', email: 'test@example.com' }
  },
  validUserNoEmail: {
    token: 'valid_jwt_no_email',
    user: { id: 'test-user-id-2' }
  },
  differentUser: {
    token: 'valid_jwt_different_user',
    user: { id: 'test-user-id-3', email: 'different@example.com' }
  },
  invalidToken: 'invalid_jwt_token',
  expiredToken: 'expired_jwt_token',
  malformedToken: 'malformed_jwt_token',
  timeoutToken: 'timeout_token',
  serverErrorToken: 'server_error_token',
  malformedResponseToken: 'malformed_response_token'
}