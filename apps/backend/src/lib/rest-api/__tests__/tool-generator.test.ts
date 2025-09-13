import { describe, it, expect } from '@jest/globals';
import { RestApiToolGenerator } from '../tool-generator';
import { RestApiSpecification, RestApiEndpoint } from '@repo/zod-types';

describe('RestApiToolGenerator', () => {
  describe('generateTools', () => {
    it('should generate MCP tools from REST API specification', () => {
      const apiSpec: RestApiSpecification = {
        name: 'Test API',
        version: '1.0.0',
        endpoints: [
          {
            name: 'getUser',
            method: 'GET',
            path: '/users/{id}',
            description: 'Get user by ID',
            parameters: [
              {
                name: 'id',
                in: 'path',
                type: 'string',
                required: true,
                description: 'User ID',
              },
            ],
            responses: [
              {
                statusCode: 200,
                description: 'User found',
              },
            ],
            headers: {},
          },
          {
            name: 'createUser',
            method: 'POST',
            path: '/users',
            description: 'Create a new user',
            requestBody: {
              contentType: 'application/json',
              required: true,
            },
            responses: [
              {
                statusCode: 201,
                description: 'User created',
              },
            ],
            headers: {},
          },
        ],
      };

      const tools = RestApiToolGenerator.generateTools(apiSpec, 'test_api');

      expect(tools).toHaveLength(2);
      
      // Check first tool (getUser)
      expect(tools[0].name).toBe('test_api__getUser');
      expect(tools[0].description).toContain('Get user by ID');
      expect(tools[0].inputSchema.properties).toHaveProperty('id');
      expect(tools[0].inputSchema.required).toContain('id');
      expect(tools[0]._restApi.endpoint.name).toBe('getUser');

      // Check second tool (createUser)
      expect(tools[1].name).toBe('test_api__createUser');
      expect(tools[1].description).toContain('Create a new user');
      expect(tools[1].inputSchema.properties).toHaveProperty('body');
      expect(tools[1].inputSchema.required).toContain('body');
      expect(tools[1]._restApi.endpoint.name).toBe('createUser');
    });

    it('should handle endpoints without parameters', () => {
      const apiSpec: RestApiSpecification = {
        name: 'Simple API',
        version: '1.0.0',
        endpoints: [
          {
            name: 'getHealth',
            method: 'GET',
            path: '/health',
            description: 'Health check endpoint',
            responses: [],
            headers: {},
          },
        ],
      };

      const tools = RestApiToolGenerator.generateTools(apiSpec, 'simple_api');

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('simple_api__getHealth');
      expect(tools[0].inputSchema.properties).toEqual({});
      expect(tools[0].inputSchema.required).toBeUndefined();
    });

    it('should sanitize server names for tool names', () => {
      const apiSpec: RestApiSpecification = {
        name: 'Test API',
        version: '1.0.0',
        endpoints: [
          {
            name: 'test',
            method: 'GET',
            path: '/test',
            responses: [],
            headers: {},
          },
        ],
      };

      const tools = RestApiToolGenerator.generateTools(apiSpec, 'My-API Server!@#');

      expect(tools[0].name).toBe('My-API_Server___test');
    });
  });

  describe('validateEndpoint', () => {
    it('should validate valid endpoint', () => {
      const endpoint: RestApiEndpoint = {
        name: 'getUser',
        method: 'GET',
        path: '/users/{id}',
        description: 'Get user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            type: 'string',
            required: true,
          },
        ],
        responses: [],
        headers: {},
      };

      const result = RestApiToolGenerator.validateEndpoint(endpoint);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing endpoint name', () => {
      const endpoint: RestApiEndpoint = {
        name: '',
        method: 'GET',
        path: '/test',
        responses: [],
        headers: {},
      };

      const result = RestApiToolGenerator.validateEndpoint(endpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Endpoint name is required');
    });

    it('should detect missing path', () => {
      const endpoint: RestApiEndpoint = {
        name: 'test',
        method: 'GET',
        path: '',
        responses: [],
        headers: {},
      };

      const result = RestApiToolGenerator.validateEndpoint(endpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Endpoint path is required');
    });

    it('should detect invalid HTTP method', () => {
      const endpoint: RestApiEndpoint = {
        name: 'test',
        method: 'INVALID' as any,
        path: '/test',
        responses: [],
        headers: {},
      };

      const result = RestApiToolGenerator.validateEndpoint(endpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid HTTP method');
    });

    it('should detect undefined path parameters', () => {
      const endpoint: RestApiEndpoint = {
        name: 'test',
        method: 'GET',
        path: '/users/{id}/posts/{postId}',
        parameters: [
          {
            name: 'id',
            in: 'path',
            type: 'string',
            required: true,
          },
          // Missing postId parameter
        ],
        responses: [],
        headers: {},
      };

      const result = RestApiToolGenerator.validateEndpoint(endpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Path parameter {postId} is not defined in parameters');
    });

    it('should detect invalid parameter location', () => {
      const endpoint: RestApiEndpoint = {
        name: 'test',
        method: 'GET',
        path: '/test',
        parameters: [
          {
            name: 'param',
            in: 'invalid' as any,
            type: 'string',
            required: true,
          },
        ],
        responses: [],
        headers: {},
      };

      const result = RestApiToolGenerator.validateEndpoint(endpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid parameter location: invalid');
    });
  });

  describe('utility functions', () => {
    it('should extract endpoint name from tool name', () => {
      const toolName = 'my_api__getUserById';
      const endpointName = RestApiToolGenerator.extractEndpointName(toolName);
      expect(endpointName).toBe('getUserById');
    });

    it('should extract server name from tool name', () => {
      const toolName = 'my_api__getUserById';
      const serverName = RestApiToolGenerator.extractServerName(toolName);
      expect(serverName).toBe('my_api');
    });

    it('should identify REST API tools', () => {
      expect(RestApiToolGenerator.isRestApiTool('my_api__getUser')).toBe(true);
      expect(RestApiToolGenerator.isRestApiTool('regularTool')).toBe(false);
      expect(RestApiToolGenerator.isRestApiTool('single_underscore')).toBe(false);
    });

    it('should generate tool documentation', () => {
      const endpoint: RestApiEndpoint = {
        name: 'getUser',
        method: 'GET',
        path: '/users/{id}',
        description: 'Get user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            type: 'string',
            required: true,
            description: 'User ID',
          },
        ],
        requestBody: {
          contentType: 'application/json',
          required: true,
        },
        responses: [
          {
            statusCode: 200,
            description: 'User found',
          },
          {
            statusCode: 404,
            description: 'User not found',
          },
        ],
        headers: {},
      };

      const tool = {
        name: 'test_api__getUser',
        description: 'Get user by ID',
        inputSchema: {},
        _restApi: {
          endpoint,
          serverName: 'test_api',
        },
      };

      const documentation = RestApiToolGenerator.generateToolDocumentation(tool);

      expect(documentation).toContain('# test_api__getUser');
      expect(documentation).toContain('**Method:** GET');
      expect(documentation).toContain('**Path:** /users/{id}');
      expect(documentation).toContain('Get user by ID');
      expect(documentation).toContain('## Parameters');
      expect(documentation).toContain('- **id** (string, path) *required*: User ID');
      expect(documentation).toContain('## Request Body');
      expect(documentation).toContain('## Responses');
      expect(documentation).toContain('- **200**: User found');
      expect(documentation).toContain('- **404**: User not found');
    });
  });
});
