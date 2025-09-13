import { describe, it, expect, beforeEach } from '@jest/globals';
import { RestApiConverter } from '../rest-api-converter';
import { SimpleJsonApi, OpenApiSpec, ManualApiForm } from '@repo/zod-types';

describe('RestApiConverter', () => {
  let converter: RestApiConverter;

  beforeEach(() => {
    converter = new RestApiConverter();
  });

  describe('Simple JSON conversion', () => {
    it('should convert simple JSON API specification', async () => {
      const simpleApi: SimpleJsonApi = {
        name: 'Test API',
        description: 'A test API',
        base_url: 'https://api.example.com',
        auth: {
          type: 'bearer',
          token: 'test-token',
        },
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
          },
        ],
      };

      const result = await converter.validateAndConvert('simple_json', simpleApi);

      expect(result.apiSpec.name).toBe('Test API');
      expect(result.apiSpec.endpoints).toHaveLength(1);
      expect(result.apiSpec.endpoints[0].name).toBe('getUser');
      expect(result.baseUrl).toBe('https://api.example.com');
      expect(result.authConfig?.type).toBe('bearer');
      expect(result.warnings).toEqual([]);
    });

    it('should handle API without authentication', async () => {
      const simpleApi: SimpleJsonApi = {
        name: 'Public API',
        base_url: 'https://api.example.com',
        endpoints: [
          {
            name: 'getPublicData',
            method: 'GET',
            path: '/public',
          },
        ],
      };

      const result = await converter.validateAndConvert('simple_json', simpleApi);

      expect(result.authConfig).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });
  });

  describe('Manual form conversion', () => {
    it('should convert manual form data', async () => {
      const manualForm: ManualApiForm = {
        name: 'Manual API',
        description: 'Manually configured API',
        base_url: 'https://api.example.com',
        auth_type: 'api_key',
        auth_key: 'test-key',
        auth_key_location: 'header',
        auth_key_name: 'X-API-Key',
        endpoints: [
          {
            name: 'createUser',
            method: 'POST',
            path: '/users',
            description: 'Create a new user',
            parameters_json: JSON.stringify([
              {
                name: 'name',
                in: 'query',
                type: 'string',
                required: true,
              },
            ]),
            request_body_json: JSON.stringify({
              contentType: 'application/json',
              required: true,
            }),
          },
        ],
      };

      const result = await converter.validateAndConvert('manual', manualForm);

      expect(result.apiSpec.name).toBe('Manual API');
      expect(result.apiSpec.endpoints).toHaveLength(1);
      expect(result.apiSpec.endpoints[0].parameters).toHaveLength(1);
      expect(result.authConfig?.type).toBe('api_key');
      expect(result.authConfig?.config?.key).toBe('test-key');
    });

    it('should handle invalid JSON in manual form', async () => {
      const manualForm: ManualApiForm = {
        name: 'Invalid JSON API',
        base_url: 'https://api.example.com',
        auth_type: 'none',
        endpoints: [
          {
            name: 'testEndpoint',
            method: 'GET',
            path: '/test',
            parameters_json: 'invalid json',
          },
        ],
      };

      const result = await converter.validateAndConvert('manual', manualForm);

      expect(result.warnings).toContain('Invalid parameters JSON for endpoint testEndpoint');
    });
  });

  describe('OpenAPI conversion', () => {
    it('should convert basic OpenAPI specification', async () => {
      const openApiSpec: OpenApiSpec = {
        openapi: '3.0.0',
        info: {
          title: 'OpenAPI Test',
          version: '1.0.0',
          description: 'Test OpenAPI spec',
        },
        servers: [
          {
            url: 'https://api.example.com',
          },
        ],
        paths: {
          '/users/{id}': {
            get: {
              operationId: 'getUser',
              summary: 'Get user by ID',
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: {
                    type: 'string',
                  },
                },
              ],
              responses: {
                '200': {
                  description: 'User found',
                },
              },
            },
          },
        },
      };

      const result = await converter.validateAndConvert('openapi', openApiSpec);

      expect(result.apiSpec.name).toBe('OpenAPI Test');
      expect(result.apiSpec.endpoints).toHaveLength(1);
      expect(result.apiSpec.endpoints[0].name).toBe('getUser');
      expect(result.baseUrl).toBe('https://api.example.com');
    });

    it('should handle OpenAPI spec without servers', async () => {
      const openApiSpec: OpenApiSpec = {
        openapi: '3.0.0',
        info: {
          title: 'No Servers API',
          version: '1.0.0',
        },
        paths: {
          '/test': {
            get: {
              responses: {
                '200': {
                  description: 'OK',
                },
              },
            },
          },
        },
      };

      await expect(
        converter.validateAndConvert('openapi', openApiSpec)
      ).rejects.toThrow('No servers defined in OpenAPI specification');
    });

    it('should handle multiple servers with warning', async () => {
      const openApiSpec: OpenApiSpec = {
        openapi: '3.0.0',
        info: {
          title: 'Multi Server API',
          version: '1.0.0',
        },
        servers: [
          {
            url: 'https://api.example.com',
          },
          {
            url: 'https://staging.api.example.com',
          },
        ],
        paths: {
          '/test': {
            get: {
              responses: {
                '200': {
                  description: 'OK',
                },
              },
            },
          },
        },
      };

      const result = await converter.validateAndConvert('openapi', openApiSpec);

      expect(result.baseUrl).toBe('https://api.example.com');
      expect(result.warnings).toContain(
        'Multiple servers found, using first one: https://api.example.com'
      );
    });
  });

  describe('Error handling', () => {
    it('should throw error for unsupported format', async () => {
      await expect(
        converter.validateAndConvert('unsupported' as any, {})
      ).rejects.toThrow('Unsupported import format: unsupported');
    });
  });

  describe('Authentication conversion', () => {
    it('should convert bearer authentication', async () => {
      const simpleApi: SimpleJsonApi = {
        name: 'Bearer API',
        base_url: 'https://api.example.com',
        auth: {
          type: 'bearer',
          token: 'bearer-token',
        },
        endpoints: [
          {
            name: 'test',
            method: 'GET',
            path: '/test',
          },
        ],
      };

      const result = await converter.validateAndConvert('simple_json', simpleApi);

      expect(result.authConfig?.type).toBe('bearer');
      expect(result.authConfig?.config?.token).toBe('bearer-token');
    });

    it('should convert basic authentication', async () => {
      const simpleApi: SimpleJsonApi = {
        name: 'Basic API',
        base_url: 'https://api.example.com',
        auth: {
          type: 'basic',
          username: 'user',
          password: 'pass',
        },
        endpoints: [
          {
            name: 'test',
            method: 'GET',
            path: '/test',
          },
        ],
      };

      const result = await converter.validateAndConvert('simple_json', simpleApi);

      expect(result.authConfig?.type).toBe('basic');
      expect(result.authConfig?.config?.username).toBe('user');
      expect(result.authConfig?.config?.password).toBe('pass');
    });

    it('should convert API key authentication', async () => {
      const simpleApi: SimpleJsonApi = {
        name: 'API Key API',
        base_url: 'https://api.example.com',
        auth: {
          type: 'api_key',
          key: 'api-key',
          name: 'X-API-Key',
          location: 'header',
        },
        endpoints: [
          {
            name: 'test',
            method: 'GET',
            path: '/test',
          },
        ],
      };

      const result = await converter.validateAndConvert('simple_json', simpleApi);

      expect(result.authConfig?.type).toBe('api_key');
      expect(result.authConfig?.config?.key).toBe('api-key');
      expect(result.authConfig?.config?.name).toBe('X-API-Key');
      expect(result.authConfig?.config?.location).toBe('header');
    });
  });
});
