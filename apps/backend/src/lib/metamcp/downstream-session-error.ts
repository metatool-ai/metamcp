export class DownstreamSessionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownstreamSessionUnavailableError";
  }
}

export function createDownstreamSessionUnavailableError(
  toolName: string,
  serverLabel: string,
): DownstreamSessionUnavailableError {
  return new DownstreamSessionUnavailableError(
    `Cannot call tool "${toolName}": matched backend server "${serverLabel}", but MetaMCP could not obtain a live downstream MCP session. Retry after the backend reconnects, or increase MAX_CONNECTIONS_PER_SERVER if this is caused by pool exhaustion.`,
  );
}
