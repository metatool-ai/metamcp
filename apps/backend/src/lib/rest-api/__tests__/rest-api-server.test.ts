import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RestApiMcpServer } from '../rest-api-server';
import { ServerParameters } from '@repo/zod-types';

// Mock fetch globally
global.fetch = jest.fn();

describe('RestApiMcpServer', () => {
  let server: RestApiMcpServer;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();

    const serverParams: ServerParameters = {
      uuid: 'test-uuid',
      name: 'Test API Server',
      description: 'Test REST API server',
      type: 'REST_API',
      command: null,
      args: null,
      url: null,
      bearer_token: null,
      env: null,
      user_id: 'test-user',
      api_spec: {
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
        ],
      },
      base_url: 'https://api.example.com',
      auth_config: {
        type: 'bearer',
        config: {
          token: 'test-token',
        },
      },
    };

    server = new RestApiMcpServer(serverParams);
  });

  describe('listTools', () => {
    it('should list available tools', async () => {
      const result = await server.listTools();

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('Test API Server__getUser');
      expect(result.tools[0].description).toContain('Get user by ID');
      expect(result.tools[0].inputSchema.properties).toHaveProperty('id');
    });
  });

  describe('callTool', () => {
    it('should successfully call a REST API tool', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'application/json',
        }),
        json: async () => ({ id: '123', name: 'John Doe' }),
      };

      mockFetch.mockResolvedValueOnce(mockResponse as any);

      const result = await server.callTool('Test API Server__getUser', { id: '123' });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('GET /users/{id}');
      expect(result.content[0].text).toContain('Status: 200 OK');
      expect(result.content[0].text).toContain('"id": "123"');
      expect(result.content[0].text).toContain('"name": "John Doe"');

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
            'User-Agent': 'MetaMCP-RestAPI/1.0',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: async () => 'User not found',
      };

      mockFetch.mockResolvedValueOnce(mockResponse as any);

      const result = await server.callTool('Test API Server__getUser', { id: '999' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Status: 404 Not Found');
    });

    it('should handle missing required parameters', async () => {
      const result = await server.callTool('Test API Server__getUser', {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Required parameter 'id' is missing");
    });

    it('should handle unknown tools', async () => {
      const result = await server.callTool('unknown_tool', {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool: unknown_tool');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await server.callTool('Test API Server__getUser', { id: '123' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });

  describe('testConnection', () => {
    it('should test connection successfully', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
      };

      mockFetch.mockResolvedValueOnce(mockResponse as any);

      const result = await server.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
    });

    it('should handle connection failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await server.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
    });
  });

  describe('getServerInfo', () => {
    it('should return server information', () => {
      const info = server.getServerInfo();

      expect(info.name).toBe('Test API Server');
      expect(info.type).toBe('REST_API');
      expect(info.toolsCount).toBe(1);
      expect(info.endpoints).toHaveLength(1);
      expect(info.endpoints[0].name).toBe('getUser');
      expect(info.endpoints[0].method).toBe('GET');
      expect(info.endpoints[0].path).toBe('/users/{id}');
    });
  });

  describe('parameter validation', () => {
    it('should validate string parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => 'OK',
      };

      mockFetch.mockResolvedValueOnce(mockResponse as any);

      // Should work with string
      const result1 = await server.callTool('Test API Server__getUser', { id: 'valid-string' });
      expect(result1.isError).toBe(false);

      // Should fail with non-string
      const result2 = await server.callTool('Test API Server__getUser', { id: 123 });
      expect(result2.isError).toBe(true);
      expect(result2.content[0].text).toContain("Parameter 'id' must be a string");
    });
  });

  describe('constructor validation', () => {
    it('should throw error for invalid server type', () => {
      const invalidParams = {
        uuid: 'test',
        name: 'Test',
        type: 'STDIO' as any,
        user_id: 'test',
      };

      expect(() => new RestApiMcpServer(invalidParams)).toThrow('Invalid server type for REST API server');
    });

    it('should throw error for missing required fields', () => {
      const invalidParams = {
        uuid: 'test',
        name: 'Test',
        type: 'REST_API' as any,
        user_id: 'test',
        // Missing base_url and api_spec
      };

      expect(() => new RestApiMcpServer(invalidParams)).toThrow('base_url and api_spec are required for REST API servers');
    });
  });
});
