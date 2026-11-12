import type { AddressInfo } from "node:net";

import { createHash } from "crypto";
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

// Regression tests for the OAuth authorization flow: codes must only be
// issued after explicit, signed, same-user consent for a registered
// client/redirect_uri with S256 PKCE, and must be single-use.

type StoredCode = {
  code: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  user_id: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  expires_at: Date;
  created_at: Date;
};

const store = vi.hoisted(() => ({
  clients: new Map<string, any>(),
  codes: new Map<string, any>(),
  tokens: [] as any[],
  refresh: new Map<string, any>(),
}));

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Session: the cookie "session=<userId>" signs that user in.
vi.mock("../../auth", () => ({
  auth: {
    handler: async (request: Request) => {
      const cookie = request.headers.get("cookie") || "";
      const match = /session=([^;]+)/.exec(cookie);
      if (!match) return new Response("null", { status: 200 });
      return new Response(JSON.stringify({ user: { id: match[1] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  },
}));

vi.mock("../../db/repositories", () => ({
  oauthRepository: {
    getClient: async (id: string) => store.clients.get(id) ?? null,
    getAuthCode: async (code: string) => store.codes.get(code) ?? null,
    setAuthCode: async (code: string, data: any) => {
      store.codes.set(code, {
        code,
        ...data,
        expires_at: new Date(data.expires_at),
        created_at: new Date(),
      } satisfies StoredCode);
    },
    deleteAuthCode: async (code: string) => {
      store.codes.delete(code);
    },
    consumeAuthCode: async (code: string) => {
      const row = store.codes.get(code) ?? null;
      store.codes.delete(code);
      return row;
    },
    setAccessToken: async (token: string, data: any) => {
      store.tokens.push({ access_token: token, ...data });
    },
    getByRefreshToken: async (t: string) => store.refresh.get(t) ?? null,
    deleteAccessToken: async () => undefined,
    consumeRefreshToken: async (t: string) => {
      const row = store.refresh.get(t) ?? null;
      store.refresh.delete(t);
      return row;
    },
  },
}));

process.env.BETTER_AUTH_SECRET = "test-secret-for-consent-signing";
process.env.APP_URL = "http://app.test";

const { default: authorizationRouter } = await import("./authorization");
const { default: tokenRouter } = await import("./token");
const { signConsentRequest, CONSENT_TTL_MS } = await import("./consent");

const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "http://127.0.0.1:5000/callback";

let baseUrl: string;
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(authorizationRouter);
  app.use(tokenRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  store.clients.clear();
  store.codes.clear();
  store.tokens.length = 0;
  store.refresh.clear();
  store.clients.set("client-1", {
    client_id: "client-1",
    client_secret: null,
    client_name: 'Evil <script>alert("x")</script>',
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: "none",
  });
});

function authorizeQuery(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: REDIRECT,
    state: "xyz",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...overrides,
  }).toString();
}

function locationOf(res: Response): string {
  const value = res.headers.get("location");
  if (!value) throw new Error("expected a Location header");
  return value;
}

const validParams = {
  client_id: "client-1",
  redirect_uri: REDIRECT,
  scope: "admin",
  state: "xyz",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
};

async function submit(
  path: "approve" | "deny",
  request: string,
  opts: { user?: string; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (opts.user !== undefined) headers.cookie = `session=${opts.user}`;
  if (opts.origin) headers.origin = opts.origin;
  return fetch(`${baseUrl}/oauth/authorize/${path}`, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams({ request }).toString(),
  });
}

describe("GET /oauth/authorize", () => {
  it("renders an escaped consent page instead of redirecting with a code", async () => {
    const res = await fetch(`${baseUrl}/oauth/authorize?${authorizeQuery()}`, {
      redirect: "manual",
      headers: { cookie: "session=alice" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const html = await res.text();
    expect(html).toContain('action="/oauth/authorize/approve"');
    expect(html).toContain("127.0.0.1:5000");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(store.codes.size).toBe(0);
    expect(res.headers.get("content-security-policy")).toContain(
      "form-action 'self' http://127.0.0.1:5000",
    );
  });

  it("sends signed-out users to login and back to /oauth/authorize", async () => {
    const res = await fetch(`${baseUrl}/oauth/authorize?${authorizeQuery()}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(locationOf(res));
    expect(location.pathname).toBe("/login");
    const callback = location.searchParams.get("callbackUrl") ?? "";
    expect(callback.startsWith("/oauth/authorize?")).toBe(true);
    expect(new URLSearchParams(callback.split("?")[1]).get("client_id")).toBe(
      "client-1",
    );
  });

  it("rejects the plain PKCE method", async () => {
    const res = await fetch(
      `${baseUrl}/oauth/authorize?${authorizeQuery({
        code_challenge_method: "plain",
        code_challenge: VERIFIER,
      })}`,
      { redirect: "manual", headers: { cookie: "session=alice" } },
    );
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });

  it("rejects an unregistered redirect_uri", async () => {
    const res = await fetch(
      `${baseUrl}/oauth/authorize?${authorizeQuery({
        redirect_uri: "https://evil.example/cb",
      })}`,
      { redirect: "manual", headers: { cookie: "session=alice" } },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /oauth/authorize/approve", () => {
  it("issues a code for a valid signed request from the same user", async () => {
    const res = await submit(
      "approve",
      signConsentRequest(validParams, "alice"),
      {
        user: "alice",
        origin: "http://app.test",
      },
    );
    expect(res.status).toBe(302);
    const location = new URL(locationOf(res));
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code") ?? "";
    expect(store.codes.get(code)?.user_id).toBe("alice");
  });

  it("deny redirects with access_denied and no code", async () => {
    const res = await submit("deny", signConsentRequest(validParams, "alice"), {
      user: "alice",
    });
    expect(res.status).toBe(302);
    const location = new URL(locationOf(res));
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("code")).toBeNull();
    expect(store.codes.size).toBe(0);
  });

  it("rejects a tampered signature", async () => {
    const blob = signConsentRequest(validParams, "alice");
    const [payload] = blob.split(".");
    const forged = `${payload}.${"A".repeat(43)}`;
    const res = await submit("approve", forged, { user: "alice" });
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });

  it("rejects a payload swapped under a valid signature", async () => {
    const blob = signConsentRequest(validParams, "alice");
    const sig = blob.split(".")[1];
    const evilPayload = Buffer.from(
      JSON.stringify({
        ...validParams,
        redirect_uri: "https://evil.example/cb",
        uid: "alice",
        exp: Date.now() + 60_000,
      }),
    ).toString("base64url");
    const res = await submit("approve", `${evilPayload}.${sig}`, {
      user: "alice",
    });
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });

  it("rejects an expired request", async () => {
    const blob = signConsentRequest(
      validParams,
      "alice",
      Date.now() - CONSENT_TTL_MS - 1000,
    );
    const res = await submit("approve", blob, { user: "alice" });
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });

  it("rejects a request signed for another user", async () => {
    const res = await submit(
      "approve",
      signConsentRequest(validParams, "bob"),
      {
        user: "alice",
      },
    );
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });

  it("rejects when not signed in (e.g. cross-site POST without cookie)", async () => {
    const res = await submit(
      "approve",
      signConsentRequest(validParams, "alice"),
    );
    expect(res.status).toBe(401);
    expect(store.codes.size).toBe(0);
  });

  it("rejects a foreign Origin", async () => {
    const res = await submit(
      "approve",
      signConsentRequest(validParams, "alice"),
      {
        user: "alice",
        origin: "https://evil.example",
      },
    );
    expect(res.status).toBe(403);
    expect(store.codes.size).toBe(0);
  });

  it("re-validates that the redirect_uri is still registered", async () => {
    const blob = signConsentRequest(
      { ...validParams, redirect_uri: "https://evil.example/cb" },
      "alice",
    );
    const res = await submit("approve", blob, { user: "alice" });
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });

  it("re-validates PKCE method even inside a signed request", async () => {
    const blob = signConsentRequest(
      { ...validParams, code_challenge_method: "plain" },
      "alice",
    );
    const res = await submit("approve", blob, { user: "alice" });
    expect(res.status).toBe(400);
    expect(store.codes.size).toBe(0);
  });
});

describe("GET /oauth/callback", () => {
  it("never mints a code from attacker-supplied params", async () => {
    store.clients.set("evil", {
      client_id: "evil",
      client_secret: null,
      client_name: "evil",
      redirect_uris: ["https://evil.example/cb"],
      token_endpoint_auth_method: "none",
    });
    const params = Buffer.from(
      JSON.stringify({
        client_id: "evil",
        redirect_uri: "https://evil.example/cb",
        code_challenge: CHALLENGE,
        code_challenge_method: "S256",
      }),
    ).toString("base64url");
    const res = await fetch(`${baseUrl}/oauth/callback?params=${params}`, {
      redirect: "manual",
      headers: { cookie: "session=alice" },
    });
    expect(res.status).toBe(302);
    const location = locationOf(res);
    expect(location.startsWith("/oauth/authorize?")).toBe(true);
    expect(location).not.toContain("code=");
    expect(store.codes.size).toBe(0);
  });

  it("escapes reflected values in the debug page", async () => {
    store.clients.set("dev", {
      client_id: "dev",
      redirect_uris: ["http://app.test/oauth/callback"],
    });
    store.codes.set("mcp_code_dev", {
      code: "mcp_code_dev",
      client_id: "dev",
      redirect_uri: "http://app.test/oauth/callback",
      scope: "admin",
      user_id: "alice",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      expires_at: new Date(Date.now() + 60_000),
      created_at: new Date(),
    });
    const res = await fetch(
      `${baseUrl}/oauth/callback?code=mcp_code_dev&state=${encodeURIComponent(
        "<img src=x onerror=alert(1)>",
      )}`,
    );
    const html = await res.text();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("POST /oauth/token (authorization_code)", () => {
  async function redeem(code: string) {
    return fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: "client-1",
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }),
    });
  }

  it("a code cannot be redeemed twice, even in parallel", async () => {
    const res = await submit(
      "approve",
      signConsentRequest(validParams, "alice"),
      {
        user: "alice",
      },
    );
    const code = new URL(locationOf(res)).searchParams.get("code") ?? "";

    const results = await Promise.all([redeem(code), redeem(code)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 400]);
    expect(store.tokens).toHaveLength(1);

    const again = await redeem(code);
    expect(again.status).toBe(400);
  });
});

describe("POST /oauth/token (refresh_token)", () => {
  beforeEach(() => {
    store.clients.set("conf", {
      client_id: "conf",
      client_secret: "s3cret:with-colon",
      client_name: "confidential",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "client_secret_basic",
    });
    store.refresh.set("mcp_refresh_1", {
      access_token: "mcp_token_1",
      client_id: "conf",
      user_id: "alice",
      scope: "admin",
      refresh_token: "mcp_refresh_1",
      refresh_token_expires_at: new Date(Date.now() + 60_000),
    });
  });

  function refresh(headers: Record<string, string>, body: object = {}) {
    return fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: "mcp_refresh_1",
        ...body,
      }),
    });
  }

  const basic = (id: string, secret: string) =>
    `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

  it("requires confidential clients to authenticate", async () => {
    const res = await refresh({}, { client_id: "conf" });
    expect(res.status).toBe(401);
    expect(store.tokens).toHaveLength(0);
  });

  it("rejects a wrong secret", async () => {
    const res = await refresh({ authorization: basic("conf", "nope") });
    expect(res.status).toBe(401);
  });

  it("rejects a missing client_id", async () => {
    const res = await refresh({});
    expect(res.status).toBe(400);
  });

  it("accepts correct Basic credentials (secret containing ':')", async () => {
    const res = await refresh({
      authorization: basic("conf", "s3cret:with-colon"),
    });
    expect(res.status).toBe(200);
    expect(store.tokens).toHaveLength(1);
  });

  it("rotates: a refresh token can be used only once, even in parallel", async () => {
    const auth = { authorization: basic("conf", "s3cret:with-colon") };
    const [a, b] = await Promise.all([refresh(auth), refresh(auth)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(store.tokens).toHaveLength(1);
  });
});
