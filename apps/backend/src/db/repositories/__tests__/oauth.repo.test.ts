import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the WHERE conditions handed to each delete so we can assert the
// cleanup issues all of its statements. The db connection is faked; the real
// drizzle condition builders (lt/and/isNull) run against the real table
// schemas, which is exactly the code path the regression below exercises.
const whereCalls: unknown[] = [];

vi.mock("../../index", () => {
  return {
    db: {
      delete: () => ({
        where: (condition: unknown) => {
          whereCalls.push(condition);
          return Promise.resolve(undefined);
        },
      }),
    },
  };
});

// Import AFTER vi.mock so the repo binds to the fake db.
const { oauthRepository } = await import("../oauth.repo");

describe("OAuthRepository.cleanupExpired", () => {
  beforeEach(() => {
    whereCalls.length = 0;
  });

  it("builds and runs every cleanup delete without throwing", async () => {
    // Regression: the "refresh token is null" branch used
    // `isNotNull(...).not()`, which throws a TypeError at query-build time
    // because drizzle's SQL has no `.not()`. It must build via `isNull(...)`.
    await expect(oauthRepository.cleanupExpired()).resolves.toBeUndefined();

    // Three deletes: expired auth codes, fully-expired tokens, null-refresh
    // tokens. Each must have built a WHERE condition.
    expect(whereCalls).toHaveLength(3);
    for (const condition of whereCalls) {
      expect(condition).toBeDefined();
    }
  });
});
