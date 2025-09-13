# REST API to MCP Server Feature Design

## Overview

This feature allows users to convert REST APIs into MCP servers through the MetaMCP UI. Each API endpoint becomes an individual MCP tool that can be called by AI assistants.

## Architecture

### 1. Data Model

#### Extended MCP Server Schema
```typescript
// New server type
export const McpServerTypeEnum = z.enum(["STDIO", "SSE", "STREAMABLE_HTTP", "REST_API"]);

// Extended mcp_servers table fields
interface RestApiMcpServer {
  // Existing fields...
  type: "REST_API";
  
  // New REST API specific fields
  api_spec: RestApiSpecification; // JSON specification
  base_url: string; // Base URL for the API
  auth_config?: AuthConfiguration; // Authentication configuration
}
```

#### REST API Specification Format
```typescript
interface RestApiSpecification {
  name: string;
  description?: string;
  version?: string;
  endpoints: RestApiEndpoint[];
}

interface RestApiEndpoint {
  id: string; // Unique identifier
  name: string; // Tool name (will be prefixed with server name)
  description?: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string; // e.g., "/users/{id}"
  parameters?: RestApiParameter[];
  requestBody?: RestApiRequestBody;
  responses?: RestApiResponse[];
  headers?: Record<string, string>; // Default headers
}

interface RestApiParameter {
  name: string;
  in: "path" | "query" | "header";
  type: "string" | "number" | "boolean" | "array";
  required?: boolean;
  description?: string;
  default?: any;
  enum?: string[];
}

interface RestApiRequestBody {
  contentType: string; // e.g., "application/json"
  schema: any; // JSON schema for validation
  required?: boolean;
}

interface RestApiResponse {
  statusCode: number;
  description?: string;
  schema?: any; // JSON schema for response
}

interface AuthConfiguration {
  type: "none" | "bearer" | "api_key" | "basic";
  config?: {
    // For bearer token
    token?: string;
    
    // For API key
    key?: string;
    location?: "header" | "query";
    name?: string; // Header/query parameter name
    
    // For basic auth
    username?: string;
    password?: string;
  };
}
```

### 2. Import Formats Supported

#### A. Manual Entry
Users can manually define APIs through a form interface:
- Add endpoints one by one
- Define parameters, request/response schemas
- Configure authentication

#### B. OpenAPI/Swagger Import
- Upload OpenAPI 3.0+ JSON/YAML files
- Parse and convert to internal format
- Support for authentication schemes

#### C. Simple JSON Format
```json
{
  "name": "User Management API",
  "description": "CRUD operations for users",
  "base_url": "https://api.example.com",
  "auth": {
    "type": "bearer",
    "token": "${API_TOKEN}"
  },
  "endpoints": [
    {
      "name": "getUser",
      "method": "GET",
      "path": "/users/{id}",
      "description": "Get user by ID",
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "type": "string",
          "required": true,
          "description": "User ID"
        }
      ]
    },
    {
      "name": "createUser",
      "method": "POST",
      "path": "/users",
      "description": "Create a new user",
      "requestBody": {
        "contentType": "application/json",
        "required": true,
        "schema": {
          "type": "object",
          "properties": {
            "name": {"type": "string"},
            "email": {"type": "string"}
          },
          "required": ["name", "email"]
        }
      }
    }
  ]
}
```

### 3. Tool Generation Strategy

Each REST API endpoint becomes an MCP tool:

#### Tool Naming Convention
- Format: `{serverName}__{endpointName}`
- Example: `UserAPI__getUser`, `UserAPI__createUser`

#### Tool Parameter Mapping
- Path parameters → Required MCP tool parameters
- Query parameters → Optional MCP tool parameters  
- Request body → Single `body` parameter with JSON schema
- Headers → Handled automatically with auth config

#### Tool Execution Flow
1. Validate input parameters against endpoint schema
2. Build HTTP request (URL, method, headers, body)
3. Apply authentication configuration
4. Execute HTTP request
5. Parse and return response
6. Handle errors appropriately

### 4. Implementation Components

#### Backend Components
1. **REST API Server Type Handler** - New server type in metamcp-proxy.ts
2. **API Specification Parser** - Convert various formats to internal schema
3. **HTTP Client Wrapper** - Execute REST API calls with proper error handling
4. **Tool Generator** - Convert endpoints to MCP tools dynamically
5. **Authentication Manager** - Handle different auth types

#### Frontend Components
1. **REST API Import Dialog** - Multi-step wizard for API import
2. **API Specification Editor** - Manual endpoint configuration
3. **OpenAPI File Upload** - Parse and preview OpenAPI specs
4. **Authentication Configuration** - Auth setup forms
5. **API Testing Interface** - Test endpoints before creating server

### 5. User Experience Flow

1. **Import Method Selection**
   - Manual entry
   - OpenAPI file upload
   - JSON specification paste

2. **API Configuration**
   - Set base URL
   - Configure authentication
   - Review/edit endpoints

3. **Server Creation**
   - Generate MCP server configuration
   - Save to database
   - Add to namespace (optional)

4. **Testing & Validation**
   - Test individual endpoints
   - Validate tool generation
   - Check authentication

### 6. Example Use Cases

#### Case 1: User Management API
```
Input APIs:
- GET /users/{id} → Tool: UserAPI__getUser
- POST /users → Tool: UserAPI__createUser  
- PUT /users/{id} → Tool: UserAPI__updateUser
- DELETE /users/{id} → Tool: UserAPI__deleteUser

Result: 4 MCP tools for complete user CRUD operations
```

#### Case 2: Weather API
```
Input APIs:
- GET /weather/current?city={city} → Tool: WeatherAPI__getCurrentWeather
- GET /weather/forecast?city={city}&days={days} → Tool: WeatherAPI__getForecast

Result: 2 MCP tools for weather information
```

### 7. Technical Considerations

#### Error Handling
- HTTP errors mapped to MCP tool errors
- Validation errors for parameters
- Authentication failures
- Network timeouts

#### Performance
- Connection pooling for HTTP requests
- Response caching (optional)
- Request rate limiting

#### Security
- Secure storage of API keys/tokens
- Environment variable support for secrets
- HTTPS enforcement for external APIs

#### Scalability
- Support for large OpenAPI specifications
- Efficient tool discovery and caching
- Minimal memory footprint per server

## Next Steps

1. Extend database schema for REST API configurations
2. Create Zod schemas for API specifications
3. Implement REST_API server type handler
4. Build frontend import interfaces
5. Add comprehensive testing
