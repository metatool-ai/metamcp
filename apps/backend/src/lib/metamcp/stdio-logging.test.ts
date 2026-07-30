import { describe, expect, it } from "vitest";

import { logStdioStderr } from "./stdio-logging";

describe("logStdioStderr", () => {
  it("records stdio server output as informational logging", () => {
    const entries: Array<readonly [string, "info", string]> = [];
    const logSink = {
      addLog: (serverName: string, level: "info", message: string): void => {
        entries.push([serverName, level, message]);
      },
    };

    logStdioStderr("example-server", Buffer.from("server ready\n"), logSink);

    expect(entries).toEqual([["example-server", "info", "server ready"]]);
  });
});
