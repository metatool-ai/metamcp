import { createHash, createHmac, timingSafeEqual } from "crypto";
import express from "express";

import { auth } from "../../auth";
import { getBaseUrl } from "./utils";

/** How long a rendered consent page stays valid. */
export const CONSENT_TTL_MS = 10 * 60 * 1000;

/** The authorization request parameters that a consent decision is bound to. */
export interface ConsentRequestParams {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  resource?: string;
}

interface SignedConsentPayload extends ConsentRequestParams {
  uid: string;
  exp: number;
}

function getSigningKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    // Fail closed: never sign or accept consent blobs without a secret.
    throw new Error("BETTER_AUTH_SECRET is required for OAuth consent");
  }
  // Domain-separate the consent key from other uses of the auth secret.
  return createHmac("sha256", secret)
    .update("metamcp-oauth-consent:v1")
    .digest();
}

function hmac(data: string): string {
  return createHmac("sha256", getSigningKey()).update(data).digest("base64url");
}

/**
 * Constant-time string comparison that is safe for inputs of different
 * lengths (both sides are hashed to a fixed length first).
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Sign the validated authorization request together with the user it was
 * shown to and an expiry. Returns an opaque `payload.signature` string.
 */
export function signConsentRequest(
  params: ConsentRequestParams,
  userId: string,
  now: number = Date.now(),
): string {
  const payload: SignedConsentPayload = {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    scope: params.scope,
    state: params.state,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    resource: params.resource,
    uid: userId,
    exp: now + CONSENT_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${hmac(encoded)}`;
}

export type ConsentVerifyResult =
  | { ok: true; params: ConsentRequestParams }
  | {
      ok: false;
      reason: "malformed" | "bad_signature" | "expired" | "wrong_user";
    };

/**
 * Verify a signed consent request: signature (constant time), expiry and
 * that it was issued to the same user that is submitting it.
 */
export function verifyConsentRequest(
  blob: unknown,
  userId: string,
  now: number = Date.now(),
): ConsentVerifyResult {
  if (typeof blob !== "string") return { ok: false, reason: "malformed" };
  const dot = blob.indexOf(".");
  if (dot <= 0 || dot !== blob.lastIndexOf(".")) {
    return { ok: false, reason: "malformed" };
  }
  const encoded = blob.slice(0, dot);
  const signature = blob.slice(dot + 1);

  if (!safeEqual(signature, hmac(encoded))) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: SignedConsentPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    !payload ||
    typeof payload.client_id !== "string" ||
    typeof payload.redirect_uri !== "string" ||
    typeof payload.code_challenge !== "string" ||
    typeof payload.code_challenge_method !== "string" ||
    typeof payload.uid !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (now > payload.exp) return { ok: false, reason: "expired" };
  if (!safeEqual(payload.uid, userId)) {
    return { ok: false, reason: "wrong_user" };
  }

  return {
    ok: true,
    params: {
      client_id: payload.client_id,
      redirect_uri: payload.redirect_uri,
      scope: typeof payload.scope === "string" ? payload.scope : "admin",
      state: typeof payload.state === "string" ? payload.state : undefined,
      code_challenge: payload.code_challenge,
      code_challenge_method: payload.code_challenge_method,
      resource:
        typeof payload.resource === "string" ? payload.resource : undefined,
    },
  };
}

/**
 * Resolve the signed-in user id from the better-auth session cookie, or null.
 */
export async function getSessionUserId(
  req: express.Request,
): Promise<string | null> {
  if (!req.headers.cookie) return null;
  try {
    const sessionUrl = new URL("/api/auth/get-session", getBaseUrl(req));
    const headers = new Headers();
    headers.set("cookie", req.headers.cookie);
    const sessionResponse = await auth.handler(
      new Request(sessionUrl.toString(), { method: "GET", headers }),
    );
    if (!sessionResponse.ok) return null;
    const sessionData = (await sessionResponse.json()) as {
      user?: { id?: string };
    } | null;
    return sessionData?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * If the request carries an Origin header, it must match the app's origin.
 * Browsers always send Origin on form POSTs, so this blocks cross-site
 * submissions even if a session cookie were somehow attached.
 */
export function isSameOriginRequest(req: express.Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(getBaseUrl(req)).origin === origin;
  } catch {
    return false;
  }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the server-side consent page. Everything interpolated is escaped.
 * No script is used; Approve/Deny are plain form POSTs.
 */
export function renderConsentPage(options: {
  clientName: string;
  redirectUri: string;
  scope: string;
  signedRequest: string;
}): string {
  const redirect = new URL(options.redirectUri);
  const clientName = escapeHtml(options.clientName || "Unnamed client");
  const redirectHost = escapeHtml(redirect.host);
  const redirectFull = escapeHtml(options.redirectUri);
  const scope = escapeHtml(options.scope);
  const signed = escapeHtml(options.signedRequest);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize application</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #111; margin: 0; padding: 16px; }
  .card { max-width: 480px; margin: 48px auto; background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  .host { font-family: ui-monospace, monospace; font-weight: 600; word-break: break-all; }
  .muted { color: #555; font-size: 14px; word-break: break-all; }
  .warn { background: #fff7e6; border: 1px solid #f0d49a; border-radius: 6px; padding: 10px; font-size: 14px; }
  .actions { display: flex; gap: 12px; margin-top: 20px; }
  .actions form { flex: 1; }
  button { width: 100%; padding: 10px; font-size: 15px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  button.primary { background: #111; color: #fff; border-color: #111; }
</style>
</head>
<body>
<div class="card">
  <h1>Authorize &ldquo;${clientName}&rdquo;?</h1>
  <p>This application is requesting access to your MetaMCP account (scope: <strong>${scope}</strong>).</p>
  <p>If you approve, you will be redirected to:</p>
  <p class="host">${redirectHost}</p>
  <p class="muted">${redirectFull}</p>
  <p class="warn">Only approve if you started this sign-in yourself and recognise this application and destination.</p>
  <div class="actions">
    <form method="post" action="/oauth/authorize/deny">
      <input type="hidden" name="request" value="${signed}">
      <button type="submit">Deny</button>
    </form>
    <form method="post" action="/oauth/authorize/approve">
      <input type="hidden" name="request" value="${signed}">
      <button type="submit" class="primary">Approve</button>
    </form>
  </div>
</div>
</body>
</html>`;
}

/**
 * CSP for the consent page. form-action is also enforced on redirects that
 * follow a form submission in some browsers, so it must allow the client's
 * redirect_uri origin in addition to 'self'.
 */
export function consentPageCsp(redirectUri: string): string {
  const target = new URL(redirectUri);
  const redirectOrigin = `${target.protocol}//${target.host}`;
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `form-action 'self' ${redirectOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}
