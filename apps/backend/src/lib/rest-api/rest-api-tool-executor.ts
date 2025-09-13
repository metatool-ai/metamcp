import { RestApiTool } from "../db/repositories/rest-api-tools.repo";

export interface ToolExecutionRequest {
  tool: RestApiTool;
  parameters: Record<string, any>;
}

export interface ToolExecutionResponse {
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
  headers?: Record<string, string>;
  executionTime?: number;
}

export class RestApiToolExecutor {
  /**
   * Execute a REST API tool with the given parameters
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
    const startTime = Date.now();
    
    try {
      const { tool, parameters } = request;
      
      // Build the URL with path parameters
      let url = tool.url;
      const pathParams: Record<string, any> = {};
      const queryParams: Record<string, any> = {};
      const headerParams: Record<string, string> = {};
      
      // Extract parameters based on their location
      if (tool.input_schema.properties) {
        for (const [paramName, paramSchema] of Object.entries(tool.input_schema.properties)) {
          const paramValue = parameters[paramName];
          if (paramValue !== undefined) {
            // Determine parameter location from schema (if specified)
            const location = (paramSchema as any)?.in || 'query';
            
            switch (location) {
              case 'path':
                pathParams[paramName] = paramValue;
                url = url.replace(`{${paramName}}`, encodeURIComponent(String(paramValue)));
                break;
              case 'header':
                headerParams[paramName] = String(paramValue);
                break;
              case 'query':
              default:
                queryParams[paramName] = paramValue;
                break;
            }
          }
        }
      }
      
      // Add query parameters to URL
      if (Object.keys(queryParams).length > 0) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(queryParams)) {
          if (Array.isArray(value)) {
            value.forEach(v => searchParams.append(key, String(v)));
          } else {
            searchParams.append(key, String(value));
          }
        }
        url += (url.includes('?') ? '&' : '?') + searchParams.toString();
      }
      
      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'MetaMCP-RestAPI/1.0',
        ...tool.headers,
        ...headerParams,
      };
      
      // Add authentication headers
      if (tool.auth_value) {
        try {
          const authHeaders = JSON.parse(tool.auth_value);
          Object.assign(headers, authHeaders);
        } catch (error) {
          console.warn('Failed to parse auth headers:', error);
        }
      }
      
      // Prepare request body for POST/PUT/PATCH requests
      let body: string | undefined;
      if (['POST', 'PUT', 'PATCH'].includes(tool.request_type.toUpperCase())) {
        // For body parameters, collect all non-path/query/header parameters
        const bodyParams: Record<string, any> = {};
        if (tool.input_schema.properties) {
          for (const [paramName, paramSchema] of Object.entries(tool.input_schema.properties)) {
            const location = (paramSchema as any)?.in;
            if (!location || location === 'body') {
              const paramValue = parameters[paramName];
              if (paramValue !== undefined) {
                bodyParams[paramName] = paramValue;
              }
            }
          }
        }
        
        if (Object.keys(bodyParams).length > 0) {
          body = JSON.stringify(bodyParams);
        }
      }
      
      // Make the HTTP request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: tool.request_type.toUpperCase(),
        headers,
        body,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Parse response
      let responseData: any;
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else if (contentType.includes('text/')) {
        responseData = await response.text();
      } else {
        responseData = await response.arrayBuffer();
      }
      
      const executionTime = Date.now() - startTime;
      
      // Convert response headers to plain object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      
      return {
        success: response.ok,
        data: responseData,
        status: response.status,
        headers: responseHeaders,
        executionTime,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      };
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Request timeout (30 seconds)',
            executionTime,
          };
        }
        
        return {
          success: false,
          error: error.message,
          executionTime,
        };
      }
      
      return {
        success: false,
        error: 'Unknown error occurred',
        executionTime,
      };
    }
  }
  
  /**
   * Validate tool parameters against the input schema
   */
  validateParameters(tool: RestApiTool, parameters: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!tool.input_schema.properties) {
      return { valid: true, errors: [] };
    }
    
    // Check required parameters
    const required = tool.input_schema.required || [];
    for (const requiredParam of required) {
      if (parameters[requiredParam] === undefined || parameters[requiredParam] === null) {
        errors.push(`Missing required parameter: ${requiredParam}`);
      }
    }
    
    // Validate parameter types (basic validation)
    for (const [paramName, paramSchema] of Object.entries(tool.input_schema.properties)) {
      const paramValue = parameters[paramName];
      if (paramValue !== undefined) {
        const expectedType = (paramSchema as any)?.type;
        const actualType = typeof paramValue;
        
        if (expectedType && expectedType !== 'any') {
          switch (expectedType) {
            case 'string':
              if (actualType !== 'string') {
                errors.push(`Parameter ${paramName} must be a string, got ${actualType}`);
              }
              break;
            case 'number':
              if (actualType !== 'number') {
                errors.push(`Parameter ${paramName} must be a number, got ${actualType}`);
              }
              break;
            case 'boolean':
              if (actualType !== 'boolean') {
                errors.push(`Parameter ${paramName} must be a boolean, got ${actualType}`);
              }
              break;
            case 'array':
              if (!Array.isArray(paramValue)) {
                errors.push(`Parameter ${paramName} must be an array, got ${actualType}`);
              }
              break;
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export const restApiToolExecutor = new RestApiToolExecutor();
