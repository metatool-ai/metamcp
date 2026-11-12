import { beforeEach, describe, expect, it, vi } from "vitest";

// Finding 3: a public API key (user_id = null) must never resolve to an
// arbitrary user (previously the first row of the users table).

const mocks = vi.hoisted(() => ({ validateApiKey: vi.fn() }));

vi.mock("../../db/repositories/api-keys.repo", () => ({
  ApiKeysRepository: class {
    validateApiKey = mocks.validateApiKey;
  },
}));

import { resolveUserIdFromApiKey } from "./resolve-user";

describe("resolveUserIdFromApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the owner of a user-bound key", async () => {
    mocks.validateApiKey.mockResolvedValue({ valid: true, user_id: "u1" });
    await expect(resolveUserIdFromApiKey("sk")).resolves.toBe("u1");
  });

  it("rejects public keys instead of falling back to another user", async () => {
    mocks.validateApiKey.mockResolvedValue({ valid: true, user_id: null });
    await expect(resolveUserIdFromApiKey("sk")).rejects.toThrow(
      /Public API keys/,
    );
  });

  it("rejects invalid keys", async () => {
    mocks.validateApiKey.mockResolvedValue({ valid: false });
    await expect(resolveUserIdFromApiKey("sk")).rejects.toThrow(/Invalid/);
  });
});
