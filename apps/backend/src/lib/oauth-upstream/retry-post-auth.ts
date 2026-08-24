// Post-auth tools/list retry helper.
//
// Symptom (issue #298): immediately after `frontend.oauth.exchangeToken`
// writes the tokens to `oauth_sessions`, MetaMCP opens an idle session
// against the upstream. The first request lands while the upstream is
// still wiring up its per-session state, producing one of:
//
//   - `SyntaxError: Unexpected end of JSON input` (the MCP SDK's
//     `consumeBody` on an empty body)
//   - `Error: Connection refused` / `ECONNREFUSED`
//   - HTTP 5xx with empty / malformed body
//
// A manual reconnect ~1s later always succeeds, so the cure is a short
// retry envelope, NOT longer back-off in the outer connect loop.
//
// Shape: the caller (`connectMetaMcpClient`) already runs `client.connect`
// once inside its existing try/catch. When that catch fires we ask this
// helper to recover — if the conditions match it sleeps and retries the
// op a few times with exponential backoff. The helper does NOT run the
// op itself the first time; the outer attempt already did. That keeps
// the cleanup-on-failure path in one place (the caller's catch).
//
// Scoping rules — enforced here, not at the call site:
//   - Active ONLY when tokens were issued within `postAuthWindowMs` of
//     the failure. Outside the window the helper returns `null`, signalling
//     "this is not a post-auth race; do your normal retry/backoff".
//   - Up to `backoffMs.length` retries (default 3: 250 / 500 / 1000 ms).
//   - Only the error matrix above is retryable. Anything else — and
//     specifically 401/403/4xx-with-OAuth-error — returns `null` so the
//     caller's refresh-on-401 / upstream-error paths handle it.

export interface PostAuthRetryOptions {
  // The error the initial attempt threw. The helper inspects this to
  // decide whether the symptom is a post-auth race or something else.
  initialError: unknown;
  // When the upstream's OAuth tokens were last issued. The retry window
  // closes `postAuthWindowMs` after this timestamp; outside it the
  // helper bails and the caller's normal retry path takes over.
  tokensIssuedAt: Date | null;
  // Default 10s. Generous enough to cover the upstream's session-init
  // latency without papering over genuinely-broken servers indefinitely.
  postAuthWindowMs?: number;
  // Default [250, 500, 1000]. The number of entries dictates retry count.
  backoffMs?: number[];
  // Optional sleep override for tests. Defaults to setTimeout-based.
  sleep?: (ms: number) => Promise<void>;
  // Optional clock for tests. Defaults to Date.now().
  now?: () => number;
}

// `succeeded` carries the op's return value; `exhausted` means every
// retry attempt also failed. `skipped` means the helper declined to
// engage (out-of-window or non-retryable error) and the caller should
// run its existing retry/backoff path. The errors are surfaced so the
// caller can log them if useful.
export type PostAuthRetryResult<T> =
  | { kind: "succeeded"; value: T }
  | { kind: "exhausted"; lastError: unknown; attempts: number }
  | { kind: "skipped"; reason: "out_of_window" | "non_retryable_error" };

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_BACKOFF_MS: readonly number[] = [250, 500, 1000];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Predicate over thrown values. The matrix is deliberately narrow:
// papering over generic 4xx / 5xx would mask real configuration errors
// (typo'd token endpoint, expired credentials, ...). See issue #298 for
// the empirical symptom list.
export function isPostAuthRetryableError(error: unknown): boolean {
  if (!error) return false;

  // HTTP-status-bearing errors. Refuse to retry anything in the 4xx
  // range (auth-relevant errors flow through refresh-on-401 / explicit
  // OAuth envelope handling). Retry 5xx that pair with empty/malformed
  // bodies; the SyntaxError detection below also covers the 5xx-with-
  // empty-body sub-case from a different angle.
  if (typeof error === "object" && error !== null) {
    const maybeStatus = (error as { status?: unknown }).status;
    if (typeof maybeStatus === "number") {
      if (maybeStatus >= 400 && maybeStatus < 500) return false;
      if (maybeStatus >= 500 && maybeStatus < 600) return true;
    }
  }

  // SyntaxError from the SDK's `consumeBody` on an empty/short body.
  // Match by instanceof OR the message string — depending on where it
  // bubbles up from we may lose the prototype chain.
  if (error instanceof SyntaxError) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (/Unexpected end of JSON input/i.test(message)) return true;

  // Connection refused (Node `fetch`/undici surfaces this string in the
  // wrapped Error message; the underlying cause carries `code:
  // "ECONNREFUSED"`). Match either form.
  if (/Connection refused/i.test(message)) return true;
  if (/ECONNREFUSED/i.test(message)) return true;
  if (typeof error === "object" && error !== null && "cause" in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause === "object" && cause !== null) {
      const causeCode = (cause as { code?: unknown }).code;
      if (causeCode === "ECONNREFUSED") return true;
    }
  }

  return false;
}

export function isInsidePostAuthWindow(
  tokensIssuedAt: Date | null,
  nowMs: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): boolean {
  if (!tokensIssuedAt) return false;
  const elapsed = nowMs - tokensIssuedAt.getTime();
  return elapsed >= 0 && elapsed <= windowMs;
}

// Recover from an initial post-auth race failure by retrying `op` a few
// times. The caller has already taken one shot — and failed; this
// helper only runs the additional attempts.
export async function recoverFromPostAuthRace<T>(
  op: () => Promise<T>,
  opts: PostAuthRetryOptions,
): Promise<PostAuthRetryResult<T>> {
  const windowMs = opts.postAuthWindowMs ?? DEFAULT_WINDOW_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => Date.now());

  if (!isInsidePostAuthWindow(opts.tokensIssuedAt, now(), windowMs)) {
    return { kind: "skipped", reason: "out_of_window" };
  }
  if (!isPostAuthRetryableError(opts.initialError)) {
    return { kind: "skipped", reason: "non_retryable_error" };
  }

  let lastError: unknown = opts.initialError;
  for (let attempt = 0; attempt < backoff.length; attempt++) {
    await sleep(backoff[attempt] ?? 0);
    try {
      const value = await op();
      return { kind: "succeeded", value };
    } catch (retryError) {
      lastError = retryError;
      // If the symptom changes mid-retry to something non-retryable
      // (e.g., the upstream came online but is now returning 401),
      // bail out so the caller's refresh-on-401 path can take over on
      // the next outer attempt instead of waiting out the full backoff.
      if (!isPostAuthRetryableError(retryError)) {
        return {
          kind: "exhausted",
          lastError: retryError,
          attempts: attempt + 1,
        };
      }
    }
  }
  return { kind: "exhausted", lastError, attempts: backoff.length };
}
