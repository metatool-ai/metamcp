## OAuth

## OAuth 2.1 Authorization Code Flow

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Auth as MetaMCP OAuth Server
    participant User as User/Browser
    participant API as MetaMCP API

    Note over Client,API: OAuth 2.1 Dynamic Registration & Authorization Flow

    Client->>Auth: POST /oauth/register<br/>{redirect_uris, client_name, ...}
    Auth-->>Client: {client_id, endpoints, security_note}

    Note over Client,Auth: PKCE Authorization Code Flow

    Client->>Client: Generate code_verifier & code_challenge
    Client->>User: Redirect to /oauth/authorize<br/>?client_id=...&code_challenge=...
    User->>Auth: GET /oauth/authorize (with PKCE)

    alt User Not Authenticated
        Auth-->>User: Redirect to /login
        User->>Auth: Login credentials
        Auth-->>User: Redirect back to authorize
    end

    Auth-->>User: Redirect to client<br/>?code=...&state=...
    User->>Client: Authorization code received

    Client->>Auth: POST /oauth/token<br/>{code, code_verifier, client_id}
    Auth->>Auth: Verify PKCE (S256)
    Auth-->>Client: {access_token, token_type, expires_in}

    Client->>API: API Request<br/>Authorization: Bearer {access_token}
    API-->>Client: Protected resource response
```

## OAuth 2.0 Token Exchange (RFC 8693)

MetaMCP supports OAuth 2.0 Token Exchange for single sign-on integration with Supabase.

### Token Exchange Flow

```mermaid
sequenceDiagram
    participant Client as MCP Client
    participant Provider as Supabase
    participant Auth as MetaMCP OAuth Server
    participant API as MetaMCP API

    Note over Client,API: OAuth 2.0 Token Exchange Flow (RFC 8693)

    Client->>Provider: Authenticate with Supabase
    Provider-->>Client: JWT access_token

    Client->>Auth: POST /oauth/token<br/>grant_type=urn:ietf:params:oauth:grant-type:token-exchange<br/>subject_token={external_jwt}<br/>subject_token_type=urn:ietf:params:oauth:token-type:access_token

    Auth->>Provider: Validate JWT token
    Provider-->>Auth: User information {id, email}

    Auth->>Auth: Auto-create/link user account
    Auth->>Auth: Generate MetaMCP access token
    Auth-->>Client: {access_token, token_type: "Bearer", expires_in}

    Client->>API: API Request<br/>Authorization: Bearer {mcp_token_...}
    API-->>Client: Protected resource response
```

### Configuration

Add these environment variables to enable token exchange with external providers:

```bash
# Supabase Configuration (Required for Supabase JWT validation)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

### Namespace-Specific Token Exchange

For namespace-scoped access, use the namespace-specific endpoint:

```bash
POST /metamcp/{namespace-endpoint}/oauth/token
```

### Usage Example

```bash
# Exchange Supabase JWT for MetaMCP token
curl -X POST http://localhost:12009/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
    "subject_token": "eyJ...",
    "subject_token_type": "urn:ietf:params:oauth:token-type:access_token"
  }'

# Response
{
  "access_token": "mcp_token_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "admin"
}
```

### Features

- **Auto Account Linking**: Automatically links external user accounts to local MetaMCP users by email
- **Supabase Integration**: Built-in JWT validation for Supabase authentication
- **Backward Compatible**: Works alongside existing Better Auth and OAuth 2.1 flows
- **Namespace Support**: Per-namespace token exchange for scoped access
- **Security**: Validates external JWTs before issuing MetaMCP tokens

### Provider Support

Currently supported:
- ✅ **Supabase** - Built-in JWT validation

To add support for additional providers, extend the `validateSubjectToken()` function in `apps/backend/src/routers/oauth/utils.ts`.