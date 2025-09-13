import {
  AuthConfiguration,
  RestApiEndpoint,
  RestApiParameter,
} from "@repo/zod-types";

export interface RestApiRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export interface RestApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
}

export class RestApiClient {
  private baseUrl: string;
  private authConfig?: AuthConfiguration;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(baseUrl: string, authConfig?: AuthConfiguration) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.authConfig = authConfig;
  }

  /**
   * Execute a REST API call for an MCP tool
   */
  async executeEndpoint(
    endpoint: RestApiEndpoint,
    parameters: Record<string, any> = {},
  ): Promise<RestApiResponse> {
    const request = this.buildRequest(endpoint, parameters);
    return await this.makeRequest(request);
  }

  /**
   * Build HTTP request from endpoint definition and parameters
   */
  private buildRequest(
    endpoint: RestApiEndpoint,
    parameters: Record<string, any>,
  ): RestApiRequest {
    // Build URL with path parameters
    let url = this.baseUrl + endpoint.path;
    const queryParams: Record<string, string> = {};
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "MetaMCP-RestAPI/1.0",
      ...endpoint.headers,
    };

    // Process parameters
    if (endpoint.parameters) {
      for (const param of endpoint.parameters) {
        const value = parameters[param.name];

        if (param.required && (value === undefined || value === null)) {
          throw new Error(`Required parameter '${param.name}' is missing`);
        }

        if (value !== undefined && value !== null) {
          const stringValue = this.convertParameterValue(value, param);

          switch (param.in) {
            case "path":
              url = url.replace(
                `{${param.name}}`,
                encodeURIComponent(stringValue),
              );
              break;
            case "query":
              queryParams[param.name] = stringValue;
              break;
            case "header":
              headers[param.name] = stringValue;
              break;
          }
        }
      }
    }

    // Add query parameters to URL
    if (Object.keys(queryParams).length > 0) {
      const searchParams = new URLSearchParams(queryParams);
      url += (url.includes("?") ? "&" : "?") + searchParams.toString();
    }

    // Apply authentication
    this.applyAuthentication(headers, queryParams);

    // Add query params from auth (if any) back to URL
    if (Object.keys(queryParams).length > 0) {
      const searchParams = new URLSearchParams(queryParams);
      const separator = url.includes("?") ? "&" : "?";
      url = url.split("?")[0] + separator + searchParams.toString();
    }

    // Handle request body
    let body: any = undefined;
    if (
      endpoint.requestBody &&
      ["POST", "PUT", "PATCH"].includes(endpoint.method)
    ) {
      if (parameters.body) {
        body = JSON.stringify(parameters.body);
      } else if (endpoint.requestBody.required) {
        throw new Error("Request body is required for this endpoint");
      }
    }

    return {
      method: endpoint.method,
      url,
      headers,
      body,
      timeout: this.defaultTimeout,
    };
  }

  /**
   * Apply authentication configuration to request
   */
  private applyAuthentication(
    headers: Record<string, string>,
    queryParams: Record<string, string>,
  ): void {
    if (!this.authConfig || this.authConfig.type === "none") {
      return;
    }

    const config = this.authConfig.config;
    if (!config) {
      return;
    }

    switch (this.authConfig.type) {
      case "bearer":
        if (config.token) {
          headers["Authorization"] = `Bearer ${config.token}`;
        }
        break;

      case "api_key":
        if (config.key && config.name) {
          if (config.location === "header") {
            headers[config.name] = config.key;
          } else if (config.location === "query") {
            queryParams[config.name] = config.key;
          }
        }
        break;

      case "basic":
        if (config.username && config.password) {
          const credentials = Buffer.from(
            `${config.username}:${config.password}`,
          ).toString("base64");
          headers["Authorization"] = `Basic ${credentials}`;
        }
        break;
    }
  }

  /**
   * Convert parameter value to string based on parameter type
   */
  private convertParameterValue(value: any, param: RestApiParameter): string {
    switch (param.type) {
      case "string":
        return String(value);
      case "number":
        return String(Number(value));
      case "boolean":
        return String(Boolean(value));
      case "array":
        if (Array.isArray(value)) {
          return value.join(",");
        }
        return String(value);
      default:
        return String(value);
    }
  }

  /**
   * Make HTTP request using fetch
   */
  private async makeRequest(request: RestApiRequest): Promise<RestApiResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeout || this.defaultTimeout,
    );

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse response body
      let data: any;
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        try {
          data = await response.json();
        } catch {
          data = await response.text();
        }
      } else {
        data = await response.text();
      }

      // Convert headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        data,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(
            `Request timeout after ${request.timeout || this.defaultTimeout}ms`,
          );
        }
        throw new Error(`HTTP request failed: ${error.message}`);
      }

      throw new Error("HTTP request failed with unknown error");
    }
  }

  /**
   * Test connection to the API
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(this.baseUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });

      return {
        success: response.ok,
        message: response.ok
          ? "Connection successful"
          : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }
}
