## OAuth

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