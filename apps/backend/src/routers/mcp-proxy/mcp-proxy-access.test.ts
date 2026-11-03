import type { AddressInfo } from "node:net";

import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Regression tests for CVE-2026-79538: the web-app MCP proxy must never take
// command, args, env or url from the request, and must only reach servers,
// namespaces and sessions the authenticated user owns (or public ones).

const mocks = vi.hoisted(() => ({
  findServer: vi.fn(),
  findNamespace: vi.fn(),
  createServer: vi.fn(),
  stdioCtor: vi.fn(),
  httpCtor: vi.fn(),
  sseCtor: vi.fn(),
  sseStart: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../middleware/better-auth-mcp.middleware", () => ({
  betterAuthMcpMiddleware: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const userId = req.headers["x-test-user"];
    if (!userId) {
      res.status(401).end();
      return;
    }
    (req as any).user = { id: userId };
    next();
  },
}));

vi.mock("../../db/repositories", () => ({
  mcpServersRepository: { findByUuid: mocks.findServer },
  namespacesRepository: { findByUuid: mocks.findNamespace },
}));

vi.mock("../../db/repositories/oauth-sessions.repo", () => ({
  oauthSessionsRepository: { findByMcpServerUuid: vi.fn(async () => null) },
}));

vi.mock("../../lib/metamcp/client", () => ({
  transformDockerUrl: (url: string) => url,
}));

vi.mock("../../lib/metamcp/mcp-server-pool", () => ({
  mcpServerPool: {
    handleServerCrashWithoutNamespace: vi.fn(),
    cleanupSession: vi.fn(async () => undefined),
  },
}));

vi.mock("../../lib/mcp-proxy", () => ({ default: vi.fn() }));

vi.mock("../../lib/metamcp/index", () => ({
  createServer: mocks.createServer,
}));

vi.mock("spawn-rx", () => ({
  findActualExecutable: (cmd: string, args: string[]) => ({ cmd, args }),
}));

vi.mock("../../lib/stdio-transport/process-managed-transport", () => ({
  ProcessManagedStdioTransport: class {
    constructor(params: unknown) {
      mocks.stdioCtor(params);
    }
    async start() {
      throw new Error("spawn disabled in tests");
    }
  },
}));

vi.mock(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    StreamableHTTPClientTransport: class {
      constructor(url: URL) {
        mocks.httpCtor(url.toString());
      }
      async start() {
        throw new Error("network disabled in tests");
      }
    },
  }),
);

vi.mock("@modelcontextprotocol/sdk/client/sse.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SSEClientTransport: class {
    constructor(url: URL) {
      mocks.sseCtor(url.toString());
    }
    async start() {
      return mocks.sseStart();
    }
    async close() {}
  },
}));

const { default: serverRouter } = await import("./server");
const { default: metamcpRouter } = await import("./metamcp");

const storedServer = (overrides: Record<string, unknown> = {}) => ({
  uuid: "srv-own",
  name: "own",
  description: null,
  type: "STDIO",
  command: "registered-mcp",
  args: ["--stdio"],
  env: { API_TOKEN: "from-db" },
  url: null,
  error_status: "NONE",
  created_at: new Date(),
  bearerToken: null,
  headers: {},
  forward_headers: {},
  user_id: "alice",
  ...overrides,
});

const sseServer = (overrides: Record<string, unknown> = {}) =>
  storedServer({
    type: "SSE",
    command: null,
    args: [],
    url: "https://upstream.example/sse",
    ...overrides,
  });

let baseUrl = "";
let close: () => void = () => {};

beforeAll(async () => {
  const app = express();
  app.use("/mcp-proxy/server", serverRouter);
  app.use("/mcp-proxy/metamcp", metamcpRouter);
  const listener = app.listen(0);
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  close = () => listener.close();
});

afterAll(() => close());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findServer.mockReset();
  mocks.findNamespace.mockReset();
  mocks.sseStart.mockRejectedValue(new Error("network disabled in tests"));
  mocks.createServer.mockResolvedValue({
    // Like the real MCP server, connect() starts the web-app transport.
    server: {
      connect: vi.fn(async (transport: { start: () => Promise<void> }) =>
        transport.start(),
      ),
    },
    cleanup: vi.fn(async () => undefined),
  });
});

const get = (path: string, user = "alice") =>
  fetch(`${baseUrl}${path}`, { headers: { "x-test-user": user } });

const post = (path: string, user: string) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "x-test-user": user, "content-type": "application/json" },
    body: "{}",
  });

// Opens an SSE stream and returns the sessionId announced in its endpoint event.
const openSse = async (path: string, user = "alice") => {
  const controller = new AbortController();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "x-test-user": user },
    signal: controller.signal,
  });
  if (!res.body) {
    throw new Error("SSE response without body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!/sessionId=([\w-]+)/.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return {
    status: res.status,
    sessionId: text.match(/sessionId=([\w-]+)/)?.[1],
    close: () => controller.abort(),
  };
};

describe("inspector proxy (/mcp-proxy/server)", () => {
  it("ignores command and args sent in the query string", async () => {
    const res = await get(
      "/mcp-proxy/server/stdio?transportType=STDIO&command=sh&args=-c%20id",
    );

    expect(res.status).toBe(404);
    expect(mocks.findServer).not.toHaveBeenCalled();
    expect(mocks.stdioCtor).not.toHaveBeenCalled();
  });

  it("does not reach another user's server", async () => {
    mocks.findServer.mockResolvedValue(storedServer({ user_id: "bob" }));

    const res = await get(
      "/mcp-proxy/server/stdio?transportType=STDIO&mcpServerUuid=srv-own",
    );

    expect(res.status).toBe(404);
    expect(mocks.stdioCtor).not.toHaveBeenCalled();
  });

  it("spawns the stored command without inheriting the app environment", async () => {
    const previous = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "must-not-leak";
    try {
      mocks.findServer.mockResolvedValue(storedServer());

      await get(
        "/mcp-proxy/server/stdio?transportType=STDIO&mcpServerUuid=srv-own&command=sh&args=-c%20id&env=%7B%22X%22%3A%221%22%7D",
      );

      expect(mocks.stdioCtor).toHaveBeenCalledTimes(1);
      const params = mocks.stdioCtor.mock.calls[0][0];
      expect(params.command).toBe("registered-mcp");
      expect(params.args).toEqual(["--stdio"]);
      expect(params.env.API_TOKEN).toBe("from-db");
      expect(params.env.X).toBeUndefined();
      expect(params.env.BETTER_AUTH_SECRET).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.BETTER_AUTH_SECRET;
      } else {
        process.env.BETTER_AUTH_SECRET = previous;
      }
    }
  });

  it("allows public servers", async () => {
    // Its own command, so the module-wide cooldown set by an earlier failed
    // start of another command does not apply.
    mocks.findServer.mockResolvedValue(
      storedServer({ user_id: null, command: "public-mcp" }),
    );

    await get(
      "/mcp-proxy/server/stdio?transportType=STDIO&mcpServerUuid=srv-own",
      "carol",
    );

    expect(mocks.stdioCtor).toHaveBeenCalledTimes(1);
  });

  it("ignores a url sent in the query string (no SSRF)", async () => {
    const res = await post(
      "/mcp-proxy/server/mcp?transportType=STREAMABLE_HTTP&url=http%3A%2F%2F169.254.169.254%2F",
      "alice",
    );

    expect(res.status).toBe(404);
    expect(mocks.httpCtor).not.toHaveBeenCalled();
  });

  it("connects streamable HTTP only to the stored url", async () => {
    mocks.findServer.mockResolvedValue(
      sseServer({
        type: "STREAMABLE_HTTP",
        url: "https://upstream.example/mcp",
      }),
    );

    await post(
      "/mcp-proxy/server/mcp?transportType=STREAMABLE_HTTP&mcpServerUuid=srv-own&url=http%3A%2F%2F10.0.0.1%2F",
      "alice",
    );

    expect(mocks.httpCtor).toHaveBeenCalledWith("https://upstream.example/mcp");
  });

  it("connects SSE only to the stored url", async () => {
    mocks.findServer.mockResolvedValue(sseServer());

    await get(
      "/mcp-proxy/server/sse?transportType=SSE&mcpServerUuid=srv-own&url=http%3A%2F%2F10.0.0.1%2F",
    );

    expect(mocks.sseCtor).toHaveBeenCalledWith("https://upstream.example/sse");
  });

  it("does not open a STDIO server through the SSE route", async () => {
    mocks.findServer.mockResolvedValue(storedServer({ command: "via-sse" }));

    const res = await get(
      "/mcp-proxy/server/sse?transportType=SSE&mcpServerUuid=srv-own",
    );

    expect(res.status).toBe(404);
    expect(mocks.stdioCtor).not.toHaveBeenCalled();
  });

  it("binds a session to the user who opened it", async () => {
    mocks.findServer.mockResolvedValue(sseServer());
    mocks.sseStart.mockResolvedValue(undefined);

    const session = await openSse(
      "/mcp-proxy/server/sse?transportType=SSE&mcpServerUuid=srv-own",
    );
    try {
      expect(session.status).toBe(200);
      expect(session.sessionId).toBeDefined();

      const asBob = await post(
        `/mcp-proxy/server/message?sessionId=${session.sessionId}`,
        "bob",
      );
      expect(asBob.status).toBe(404);

      const asAlice = await post(
        `/mcp-proxy/server/message?sessionId=${session.sessionId}`,
        "alice",
      );
      expect(asAlice.status).not.toBe(404);
    } finally {
      session.close();
    }
  });
});

describe("namespace proxy (/mcp-proxy/metamcp)", () => {
  it("does not reach another user's namespace", async () => {
    mocks.findNamespace.mockResolvedValue({ uuid: "ns-1", user_id: "bob" });

    const res = await get("/mcp-proxy/metamcp/ns-1/sse");

    expect(res.status).toBe(404);
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("opens the owner's namespace", async () => {
    mocks.findNamespace.mockResolvedValue({ uuid: "ns-1", user_id: "alice" });

    const session = await openSse("/mcp-proxy/metamcp/ns-1/sse");
    session.close();

    expect(session.status).toBe(200);
    expect(mocks.createServer).toHaveBeenCalledTimes(1);
  });

  it("binds a session to its user and namespace", async () => {
    // Public namespaces, so every caller passes the namespace check and only
    // the session binding is under test.
    mocks.findNamespace.mockImplementation(async (uuid: string) => ({
      uuid,
      user_id: null,
    }));

    const session = await openSse("/mcp-proxy/metamcp/ns-1/sse");
    try {
      expect(session.sessionId).toBeDefined();

      const asBob = await post(
        `/mcp-proxy/metamcp/ns-1/message?sessionId=${session.sessionId}`,
        "bob",
      );
      expect(asBob.status).toBe(404);

      const otherNamespace = await post(
        `/mcp-proxy/metamcp/ns-2/message?sessionId=${session.sessionId}`,
        "alice",
      );
      expect(otherNamespace.status).toBe(404);

      const asAlice = await post(
        `/mcp-proxy/metamcp/ns-1/message?sessionId=${session.sessionId}`,
        "alice",
      );
      expect(asAlice.status).not.toBe(404);
    } finally {
      session.close();
    }
  });
});
