import {
  AuthConfiguration,
  ManualApiForm,
  ManualApiFormSchema,
  OpenApiSpec,
  OpenApiSpecSchema,
  RestApiEndpoint,
  RestApiImportFormat,
  RestApiParameter,
  RestApiSpecification,
  SimpleJsonApi,
  SimpleJsonApiSchema,
} from "@repo/zod-types";

// Input sanitization utilities
class InputSanitizer {
  /**
   * Sanitize string input to prevent injection attacks
   */
  static sanitizeString(input: string, maxLength: number = 1000): string {
    if (typeof input !== "string") {
      throw new Error("Input must be a string");
    }

    // Remove potentially dangerous characters and limit length
    return input
      .replace(/[<>'"&]/g, "") // Remove HTML/XML special characters
      .replace(/javascript:/gi, "") // Remove javascript: protocol
      .replace(/data:/gi, "") // Remove data: protocol
      .replace(/vbscript:/gi, "") // Remove vbscript: protocol
      .trim()
      .substring(0, maxLength);
  }

  /**
   * Sanitize URL input
   */
  static sanitizeUrl(input: string): string {
    if (typeof input !== "string") {
      throw new Error("URL must be a string");
    }

    const sanitized = this.sanitizeString(input, 2000);

    // Validate URL format
    try {
      const url = new URL(sanitized);
      // Only allow http and https protocols
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Only HTTP and HTTPS protocols are allowed");
      }
      return url.toString();
    } catch (error) {
      throw new Error(
        `Invalid URL format: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Sanitize object keys and string values recursively
   */
  static sanitizeObject(obj: any, maxDepth: number = 10): any {
    if (maxDepth <= 0) {
      throw new Error("Maximum object depth exceeded");
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "string") {
      return this.sanitizeString(obj);
    }

    if (typeof obj === "number" || typeof obj === "boolean") {
      return obj;
    }

    if (Array.isArray(obj)) {
      if (obj.length > 1000) {
        throw new Error("Array too large");
      }
      return obj.map((item) => this.sanitizeObject(item, maxDepth - 1));
    }

    if (typeof obj === "object") {
      const keys = Object.keys(obj);
      if (keys.length > 100) {
        throw new Error("Object has too many properties");
      }

      const sanitized: any = {};
      for (const key of keys) {
        const sanitizedKey = this.sanitizeString(key, 100);
        sanitized[sanitizedKey] = this.sanitizeObject(obj[key], maxDepth - 1);
      }
      return sanitized;
    }

    return obj;
  }
}

export interface ConversionResult {
  apiSpec: RestApiSpecification;
  baseUrl: string;
  authConfig?: AuthConfiguration;
  warnings: string[];
}

export class RestApiConverter {
  /**
   * Validate and convert API specification from any supported format with input sanitization
   */
  async validateAndConvert(
    format: RestApiImportFormat,
    data: any,
  ): Promise<ConversionResult> {
    // First sanitize the input data
    const sanitizedData = InputSanitizer.sanitizeObject(data);

    // Then validate against the appropriate schema
    let validatedData: SimpleJsonApi | OpenApiSpec | ManualApiForm;

    try {
      switch (format) {
        case "simple_json":
          validatedData = SimpleJsonApiSchema.parse(sanitizedData);
          return this.convertFromSimpleJson(validatedData);
        case "openapi":
          validatedData = OpenApiSpecSchema.parse(sanitizedData);
          return this.convertFromOpenApi(validatedData);
        case "manual":
          validatedData = ManualApiFormSchema.parse(sanitizedData);
          return this.convertFromManualForm(validatedData);
        default:
          throw new Error(`Unsupported import format: ${format}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw new Error("Validation failed: Unknown error");
    }
  }

  /**
   * Convert from Simple JSON format
   */
  private convertFromSimpleJson(data: SimpleJsonApi): ConversionResult {
    const warnings: string[] = [];

    // Convert auth configuration
    let authConfig: AuthConfiguration | undefined;
    if (data.auth && data.auth.type !== "none") {
      authConfig = this.convertAuthConfig(data.auth, warnings);
    }

    // Convert endpoints
    const endpoints: RestApiEndpoint[] = data.endpoints.map((endpoint) => ({
      id: `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      name: endpoint.name,
      method: endpoint.method,
      path: endpoint.path,
      description: endpoint.description,
      parameters: endpoint.parameters || [],
      requestBody: endpoint.requestBody,
      responses: endpoint.responses || [],
      headers: endpoint.headers || {},
    }));

    const apiSpec: RestApiSpecification = {
      name: data.name,
      description: data.description,
      version: "1.0.0",
      endpoints,
    };

    return {
      apiSpec,
      baseUrl: data.base_url,
      authConfig,
      warnings,
    };
  }

  /**
   * Convert from OpenAPI specification
   */
  private convertFromOpenApi(data: OpenApiSpec): ConversionResult {
    const warnings: string[] = [];

    // Extract base URL from servers
    let baseUrl = "";
    if (data.servers && data.servers.length > 0) {
      baseUrl = data.servers[0].url;
      if (data.servers.length > 1) {
        warnings.push(`Multiple servers found, using first one: ${baseUrl}`);
      }
    } else {
      throw new Error("No servers defined in OpenAPI specification");
    }

    // Convert auth configuration from security schemes
    let authConfig: AuthConfiguration | undefined;
    if (data.components?.securitySchemes && data.security) {
      authConfig = this.convertOpenApiAuth(
        data.components.securitySchemes,
        data.security,
        warnings,
      );
    }

    // Convert paths to endpoints
    const endpoints: RestApiEndpoint[] = [];

    for (const [path, pathItem] of Object.entries(data.paths)) {
      const methods = ["get", "post", "put", "delete", "patch"] as const;

      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        const endpoint: RestApiEndpoint = {
          id: `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`,
          name:
            operation.operationId ||
            `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`,
          method: method.toUpperCase() as
            | "GET"
            | "POST"
            | "PUT"
            | "DELETE"
            | "PATCH",
          path,
          description: operation.summary || operation.description,
          parameters: this.convertOpenApiParameters(
            operation.parameters,
            pathItem.parameters,
            warnings,
          ),
          requestBody: operation.requestBody
            ? this.convertOpenApiRequestBody(operation.requestBody, warnings)
            : undefined,
          responses: this.convertOpenApiResponses(
            operation.responses,
            warnings,
          ),
          headers: {},
        };

        endpoints.push(endpoint);
      }
    }

    if (endpoints.length === 0) {
      throw new Error("No endpoints found in OpenAPI specification");
    }

    const apiSpec: RestApiSpecification = {
      name: data.info.title,
      description: data.info.description,
      version: data.info.version,
      endpoints,
    };

    return {
      apiSpec,
      baseUrl,
      authConfig,
      warnings,
    };
  }

  /**
   * Convert from manual form data
   */
  private convertFromManualForm(data: ManualApiForm): ConversionResult {
    const warnings: string[] = [];

    // Convert auth configuration
    let authConfig: AuthConfiguration | undefined;
    if (data.auth_type !== "none") {
      authConfig = this.convertManualAuth(data, warnings);
    }

    // Convert endpoints
    const endpoints: RestApiEndpoint[] = data.endpoints.map((endpoint) => {
      const convertedEndpoint: RestApiEndpoint = {
        id: `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
        name: endpoint.name,
        method: endpoint.method,
        path: endpoint.path,
        description: endpoint.description,
        parameters: [],
        responses: [],
        headers: {},
      };

      // Parse JSON fields if provided
      try {
        if (endpoint.parameters_json) {
          convertedEndpoint.parameters = JSON.parse(endpoint.parameters_json);
        }
      } catch (error) {
        warnings.push(`Invalid parameters JSON for endpoint ${endpoint.name}`);
      }

      try {
        if (endpoint.request_body_json) {
          convertedEndpoint.requestBody = JSON.parse(
            endpoint.request_body_json,
          );
        }
      } catch (error) {
        warnings.push(
          `Invalid request body JSON for endpoint ${endpoint.name}`,
        );
      }

      try {
        if (endpoint.responses_json) {
          convertedEndpoint.responses = JSON.parse(endpoint.responses_json);
        }
      } catch (error) {
        warnings.push(`Invalid responses JSON for endpoint ${endpoint.name}`);
      }

      try {
        if (endpoint.headers_json) {
          convertedEndpoint.headers = JSON.parse(endpoint.headers_json);
        }
      } catch (error) {
        warnings.push(`Invalid headers JSON for endpoint ${endpoint.name}`);
      }

      return convertedEndpoint;
    });

    const apiSpec: RestApiSpecification = {
      name: data.name,
      description: data.description,
      version: "1.0.0",
      endpoints,
    };

    return {
      apiSpec,
      baseUrl: data.base_url,
      authConfig,
      warnings,
    };
  }

  /**
   * Convert auth configuration from simple JSON format
   */
  private convertAuthConfig(auth: any, warnings: string[]): AuthConfiguration {
    switch (auth.type) {
      case "bearer":
        return {
          type: "bearer",
          config: {
            token: auth.token,
          },
        };
      case "api_key":
        return {
          type: "api_key",
          config: {
            key: auth.key,
            name: auth.name,
            location: auth.location,
          },
        };
      case "basic":
        return {
          type: "basic",
          config: {
            username: auth.username,
            password: auth.password,
          },
        };
      default:
        warnings.push(`Unsupported auth type: ${auth.type}`);
        return { type: "none" };
    }
  }

  /**
   * Convert auth configuration from manual form
   */
  private convertManualAuth(
    data: ManualApiForm,
    warnings: string[],
  ): AuthConfiguration {
    switch (data.auth_type) {
      case "bearer":
        return {
          type: "bearer",
          config: {
            token: data.auth_token,
          },
        };
      case "api_key":
        return {
          type: "api_key",
          config: {
            key: data.auth_key,
            name: data.auth_key_name,
            location: data.auth_key_location,
          },
        };
      case "basic":
        return {
          type: "basic",
          config: {
            username: data.auth_username,
            password: data.auth_password,
          },
        };
      default:
        warnings.push(`Unsupported auth type: ${data.auth_type}`);
        return { type: "none" };
    }
  }

  /**
   * Convert OpenAPI auth configuration
   */
  private convertOpenApiAuth(
    securitySchemes: Record<string, any>,
    security: any[],
    warnings: string[],
  ): AuthConfiguration | undefined {
    // For now, just handle the first security requirement
    if (security.length === 0) return undefined;

    const firstSecurity = security[0];
    const schemeName = Object.keys(firstSecurity)[0];
    const scheme = securitySchemes[schemeName];

    if (!scheme) {
      warnings.push(`Security scheme '${schemeName}' not found`);
      return undefined;
    }

    switch (scheme.type) {
      case "http":
        if (scheme.scheme === "bearer") {
          return {
            type: "bearer",
            config: {
              token: "", // Will need to be filled in by user
            },
          };
        } else if (scheme.scheme === "basic") {
          return {
            type: "basic",
            config: {
              username: "",
              password: "",
            },
          };
        }
        break;
      case "apiKey":
        return {
          type: "api_key",
          config: {
            key: "",
            name: scheme.name,
            location: scheme.in === "header" ? "header" : "query",
          },
        };
    }

    warnings.push(`Unsupported security scheme type: ${scheme.type}`);
    return undefined;
  }

  /**
   * Convert OpenAPI parameters
   */
  private convertOpenApiParameters(
    operationParams: any[] = [],
    pathParams: any[] = [],
    warnings: string[],
  ): RestApiParameter[] {
    const allParams = [...(pathParams || []), ...(operationParams || [])];

    return allParams.map((param) => ({
      name: param.name,
      in: param.in as "path" | "query" | "header",
      type: this.mapOpenApiType(param.schema?.type || "string"),
      required: param.required || false,
      description: param.description,
      default: param.schema?.default,
      enum: param.schema?.enum,
    }));
  }

  /**
   * Convert OpenAPI request body
   */
  private convertOpenApiRequestBody(requestBody: any, warnings: string[]): any {
    const contentTypes = Object.keys(requestBody.content || {});
    const contentType = contentTypes[0] || "application/json";

    if (contentTypes.length > 1) {
      warnings.push(`Multiple content types found, using: ${contentType}`);
    }

    return {
      contentType,
      required: requestBody.required || false,
      schema: requestBody.content[contentType]?.schema,
    };
  }

  /**
   * Convert OpenAPI responses
   */
  private convertOpenApiResponses(responses: any, warnings: string[]): any[] {
    return Object.entries(responses).map(
      ([statusCode, response]: [string, any]) => ({
        statusCode: parseInt(statusCode),
        description: response.description,
        schema: response.content
          ? Object.values(response.content)[0]
          : undefined,
      }),
    );
  }

  /**
   * Map OpenAPI types to our parameter types
   */
  private mapOpenApiType(
    openApiType: string,
  ): "string" | "number" | "boolean" | "array" {
    switch (openApiType) {
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return "array";
      default:
        return "string";
    }
  }
}
