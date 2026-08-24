import { describe, expect, it, vi } from "vitest";

import {
  isInsidePostAuthWindow,
  isPostAuthRetryableError,
  recoverFromPostAuthRace,
} from "./retry-post-auth";

// These tests pin the post-auth-race recovery behaviour from issue #298.
// The helper's contract is intentionally narrow:
//   - retry triggers ONLY on the empirical symptom set (empty body /
//     ECONNREFUSED / 5xx-with-empty-body)
//   - retry is gated by a "tokens were issued within the last 10s" check
//   - retry budget is exactly 3 attempts after the initial failure, with
//     250 / 500 / 1000 ms backoff sleeps
//   - non-retryable errors (401, 403, 400 + OAuth envelope) short-circuit
//     so the caller's existing refresh-on-401 / upstream-error paths can
//     handle them
//
// All time-based assertions use a fake `sleep` so the test suite stays
// in the single-millisecond range.

const ISSUED_AT = new Date("2026-05-20T12:00:00Z");
const INSIDE_WINDOW_NOW = ISSUED_AT.getTime() + 5_000; // 5s after issue
const OUTSIDE_WINDOW_NOW = ISSUED_AT.getTime() + 11_000; // 11s after issue

describe("retry-post-auth — isPostAuthRetryableError", () => {
  it("matches SyntaxError instances thrown by the SDK's consumeBody on empty body", () => {
    const err = new SyntaxError("Unexpected end of JSON input");
    expect(isPostAuthRetryableError(err)).toBe(true);
  });

  it("matches a plain Error carrying the empty-body message (prototype-stripped)", () => {
    const err = new Error("Unexpected end of JSON input");
    expect(isPostAuthRetryableError(err)).toBe(true);
  });

  it("matches Connection refused / ECONNREFUSED on the message or cause.code", () => {
    expect(
      isPostAuthRetryableError(
        new Error("Connection refused. Is the MCP server running?"),
      ),
    ).toBe(true);
    expect(
      isPostAuthRetryableError(new Error("connect ECONNREFUSED 1.2.3.4:443")),
    ).toBe(true);
    const withCause = new Error("fetch failed");
    (withCause as unknown as { cause: { code: string } }).cause = {
      code: "ECONNREFUSED",
    };
    expect(isPostAuthRetryableError(withCause)).toBe(true);
  });

  it("refuses 401/403 — those belong to refresh-on-401, not this helper", () => {
    const err401 = Object.assign(new Error("Unauthorized"), { status: 401 });
    const err403 = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(isPostAuthRetryableError(err401)).toBe(false);
    expect(isPostAuthRetryableError(err403)).toBe(false);
  });

  it("refuses 400 with an OAuth error envelope — terminal client error", () => {
    const err = Object.assign(new Error("invalid_grant"), { status: 400 });
    expect(isPostAuthRetryableError(err)).toBe(false);
  });

  it("accepts 5xx — empty/malformed bodies on 502/503 are part of the race set", () => {
    const err502 = Object.assign(new Error("Bad Gateway"), { status: 502 });
    const err503 = Object.assign(new Error("Service Unavailable"), {
      status: 503,
    });
    expect(isPostAuthRetryableError(err502)).toBe(true);
    expect(isPostAuthRetryableError(err503)).toBe(true);
  });
});

describe("retry-post-auth — isInsidePostAuthWindow", () => {
  it("returns false when tokensIssuedAt is null", () => {
    expect(isInsidePostAuthWindow(null, INSIDE_WINDOW_NOW)).toBe(false);
  });

  it("returns true within the default 10s window", () => {
    expect(isInsidePostAuthWindow(ISSUED_AT, INSIDE_WINDOW_NOW)).toBe(true);
  });

  it("returns false outside the default 10s window", () => {
    expect(isInsidePostAuthWindow(ISSUED_AT, OUTSIDE_WINDOW_NOW)).toBe(false);
  });
});

describe("retry-post-auth — recoverFromPostAuthRace", () => {
  const fakeSleep = () => {
    const sleeps: number[] = [];
    return {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      sleeps,
    };
  };

  it("succeeds on the first retry when the upstream comes online", async () => {
    // The caller's initial attempt already failed (that's what produced
    // initialError). The helper's first retry runs `op()` after sleeping
    // backoff[0]; the mock resolves on that very first call.
    const op = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("connected");
    const { sleep, sleeps } = fakeSleep();

    const result = await recoverFromPostAuthRace(op, {
      initialError: new SyntaxError("Unexpected end of JSON input"),
      tokensIssuedAt: ISSUED_AT,
      now: () => INSIDE_WINDOW_NOW,
      sleep,
    });

    expect(result.kind).toBe("succeeded");
    if (result.kind === "succeeded") {
      expect(result.value).toBe("connected");
    }
    expect(sleeps).toEqual([250]);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("uses the configured backoff schedule (250 → 500 → 1000) when retries continue to fail", async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("Connection refused"));
    const { sleep, sleeps } = fakeSleep();

    const result = await recoverFromPostAuthRace(op, {
      initialError: new Error("Connection refused"),
      tokensIssuedAt: ISSUED_AT,
      now: () => INSIDE_WINDOW_NOW,
      sleep,
    });

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      expect(result.attempts).toBe(3);
    }
    expect(sleeps).toEqual([250, 500, 1000]);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("skips with reason=non_retryable_error on HTTP 401 — refresh-on-401 path owns it", async () => {
    const op = vi.fn<() => Promise<string>>();
    const { sleep, sleeps } = fakeSleep();
    const err401 = Object.assign(new Error("Unauthorized"), { status: 401 });

    const result = await recoverFromPostAuthRace(op, {
      initialError: err401,
      tokensIssuedAt: ISSUED_AT,
      now: () => INSIDE_WINDOW_NOW,
      sleep,
    });

    expect(result.kind).toBe("skipped");
    if (result.kind === "skipped") {
      expect(result.reason).toBe("non_retryable_error");
    }
    expect(op).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
  });

  it("skips with reason=non_retryable_error on 400 + OAuth error envelope", async () => {
    const op = vi.fn<() => Promise<string>>();
    const { sleep, sleeps } = fakeSleep();
    const err400 = Object.assign(new Error("invalid_grant"), { status: 400 });

    const result = await recoverFromPostAuthRace(op, {
      initialError: err400,
      tokensIssuedAt: ISSUED_AT,
      now: () => INSIDE_WINDOW_NOW,
      sleep,
    });

    expect(result.kind).toBe("skipped");
    if (result.kind === "skipped") {
      expect(result.reason).toBe("non_retryable_error");
    }
    expect(op).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
  });

  it("skips with reason=out_of_window when 11s have passed since token issue", async () => {
    const op = vi.fn<() => Promise<string>>();
    const { sleep, sleeps } = fakeSleep();
    const err = new SyntaxError("Unexpected end of JSON input");

    const result = await recoverFromPostAuthRace(op, {
      initialError: err,
      tokensIssuedAt: ISSUED_AT,
      now: () => OUTSIDE_WINDOW_NOW,
      sleep,
    });

    expect(result.kind).toBe("skipped");
    if (result.kind === "skipped") {
      expect(result.reason).toBe("out_of_window");
    }
    expect(op).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
  });

  it("bails mid-retry when the symptom flips to a non-retryable error", async () => {
    // First retry: upstream still flaky. Second retry: it's now serving
    // 401 — should NOT keep trying; the caller's refresh-on-401 path can
    // run on the next outer iteration.
    const err401 = Object.assign(new Error("Unauthorized"), { status: 401 });
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockRejectedValueOnce(err401);
    const { sleep, sleeps } = fakeSleep();

    const result = await recoverFromPostAuthRace(op, {
      initialError: new Error("Connection refused"),
      tokensIssuedAt: ISSUED_AT,
      now: () => INSIDE_WINDOW_NOW,
      sleep,
    });

    expect(result.kind).toBe("exhausted");
    if (result.kind === "exhausted") {
      // Two retries ran: the first (250ms backoff) re-failed with the
      // race symptom, the second (500ms) returned 401 and bailed.
      expect(result.attempts).toBe(2);
      expect(result.lastError).toBe(err401);
    }
    expect(sleeps).toEqual([250, 500]);
    expect(op).toHaveBeenCalledTimes(2);
  });
});
