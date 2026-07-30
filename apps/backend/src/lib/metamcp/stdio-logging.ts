interface StdioLogSink {
  addLog(serverName: string, level: "info", message: string): void;
}

export function logStdioStderr(
  serverName: string,
  chunk: Buffer,
  logSink: StdioLogSink,
): void {
  // MCP reserves stdout for JSON-RPC. Stderr carries logs at every severity.
  logSink.addLog(serverName, "info", chunk.toString().trim());
}
