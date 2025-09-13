import {
  AuthConfiguration,
  RestApiSpecification,
  ServerParameters,
} from "@repo/zod-types";
import fs from "fs/promises";

import { DynamicMcpServerGenerator } from "./dynamic-mcp-server-generator";

/**
 * REST API MCP Server Manager
 * Manages the creation and lifecycle of dynamic MCP servers for REST APIs
 */
export class RestApiMcpServer {
  private serverParams: ServerParameters;
  private serverFilePath?: string;

  constructor(serverParams: ServerParameters) {
    if (serverParams.type !== "REST_API") {
      throw new Error("Invalid server type for REST API server");
    }

    if (!serverParams.base_url || !serverParams.api_spec) {
      throw new Error(
        "base_url and api_spec are required for REST API servers",
      );
    }

    this.serverParams = serverParams;
  }

  /**
   * Create the dynamic MCP server file
   */
  async createServerFile(
    outputDir: string = "/tmp/metamcp-servers",
  ): Promise<string> {
    this.serverFilePath = await DynamicMcpServerGenerator.createServerFile(
      this.serverParams,
      outputDir,
    );
    return this.serverFilePath;
  }

  /**
   * Get the server file path (creates it if it doesn't exist)
   */
  async getServerFilePath(
    outputDir: string = "/tmp/metamcp-servers",
  ): Promise<string> {
    if (!this.serverFilePath) {
      await this.createServerFile(outputDir);
    }
    return this.serverFilePath!;
  }

  /**
   * Test connection to the REST API
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const authConfig = this.serverParams.auth_config as
      | AuthConfiguration
      | undefined;
    return await DynamicMcpServerGenerator.testConnection(
      this.serverParams.base_url!,
      authConfig,
    );
  }

  /**
   * Get server information
   */
  getServerInfo() {
    const apiSpec = this.serverParams.api_spec as RestApiSpecification;
    return {
      name: this.serverParams.name,
      type: "REST_API" as const,
      baseUrl: this.serverParams.base_url,
      endpoints: apiSpec.endpoints.length,
      serverFile: this.serverFilePath,
    };
  }

  /**
   * Clean up server file
   */
  async cleanup(): Promise<void> {
    if (this.serverFilePath) {
      try {
        await fs.unlink(this.serverFilePath);
        this.serverFilePath = undefined;
      } catch (error) {
        console.warn(`Failed to cleanup server file: ${error}`);
      }
    }
  }
}
