import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../db/repositories/oauth-sessions.repo", () => ({
  oauthSessionsRepository: {},
}));

import { resolveEnvVariables } from "./utils";

describe("resolveEnvVariables", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://secret",
      BETTER_AUTH_SECRET: "s3cret",
      POSTGRES_PASSWORD: "pw",
      OIDC_CLIENT_SECRET: "oidc",
      MY_TOOL_TOKEN: "tool-token",
    });
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("resolves ordinary placeholders", () => {
    expect(resolveEnvVariables({ T: "${MY_TOOL_TOKEN}" })).toEqual({
      T: "tool-token",
    });
  });

  it.each([
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "POSTGRES_PASSWORD",
    "OIDC_CLIENT_SECRET",
  ])("does not leak the backend secret %s", (name) => {
    const out = resolveEnvVariables({ X: `\${${name}}` });
    expect(out.X).toBe(`\${${name}}`);
  });

  it.each([
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "NODE_OPTIONS",
    "ld_preload",
  ])("drops the code-injection variable %s", (name) => {
    const out = resolveEnvVariables({ [name]: "/tmp/evil.so", OK: "1" });
    expect(out).toEqual({ OK: "1" });
  });
});
