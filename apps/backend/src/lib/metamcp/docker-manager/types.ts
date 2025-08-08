export interface DockerMcpServer {
  containerId: string;
  serverUuid: string;
  containerName: string;
  url: string;
  serverName: string;
}

export interface ServerStatus {
  isRunning: boolean;
  wasSynced: boolean;
  containerId?: string;
  url?: string;
}

export interface DetailedServerStatus extends ServerStatus {
  retryCount: number;
  maxRetries: number;
  lastRetryAt?: Date;
  errorMessage?: string;
  status: string;
  restartCount?: number;
}

export interface RetryInfo {
  serverUuid: string;
  retryCount: number;
  maxRetries: number;
  lastRetryAt?: Date;
  errorMessage?: string;
  status: string;
}

export interface HighRestartContainer {
  serverUuid: string;
  containerId: string;
  restartCount: number;
  status: string;
}

export interface SyncResult {
  syncedCount: number;
  totalCount: number;
}

export interface ContainerInitResult {
  success: boolean;
  uuid: string;
  result?: DockerMcpServer;
  error?: unknown;
}

export interface DockerConfig {
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
}

export interface ContainerConfig {
  Image: string;
  name: string;
  Env: string[];
  ExposedPorts: Record<string, object>;
  HostConfig: {
    NetworkMode: string;
    RestartPolicy: {
      Name: string;
    };
  };
  Labels: Record<string, string>;
}
