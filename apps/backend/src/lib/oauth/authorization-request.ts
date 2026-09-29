import type { OAuthClient } from "@repo/zod-types";

import { oauthRepository } from "../../db/repositories";
import {
  generateSecureAuthCode,
  type OAuthParams,
  validateRedirectUri,
} from "../../routers/oauth/utils";

/**
 * Authorization requests of the MetaMCP OAuth server. A code is issued only
 * after the signed-in user approved the request on the consent page: the
 * endpoint used to issue one straight away to any registered client (and
 * anyone can register one) whenever the browser carried a session cookie,
 * so a single link was enough to obtain a token acting as the victim.
 */

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

export type AuthorizationRequest = {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: "S256";
};

export type AuthorizationRequestError = {
  error: "invalid_request" | "invalid_client";
  error_description: string;
};

export type ValidatedAuthorizationRequest =
  | { ok: true; request: AuthorizationRequest; client: OAuthClient }
  | ({ ok: false } & AuthorizationRequestError);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Checks an authorization request (query parameters, or a request that
 * travelled through the browser and is therefore untrusted): registered
 * client, exact registered redirect_uri, mandatory PKCE with S256 only.
 */
export async function validateAuthorizationRequest(
  params: Record<string, unknown>,
): Promise<ValidatedAuthorizationRequest> {
  const clientId = text(params.client_id);
  const redirectUri = text(params.redirect_uri);
  if (!clientId || !redirectUri) {
    return {
      ok: false,
      error: "invalid_request",
      error_description:
        "Missing required parameters: client_id or redirect_uri",
    };
  }

  const codeChallenge = text(params.code_challenge);
  if (!codeChallenge || !text(params.code_challenge_method)) {
    return {
      ok: false,
      error: "invalid_request",
      error_description:
        "PKCE parameters (code_challenge and code_challenge_method) are required per OAuth 2.1",
    };
  }
  // "plain" makes the challenge equal to the verifier, which defeats PKCE.
  if (params.code_challenge_method !== "S256") {
    return {
      ok: false,
      error: "invalid_request",
      error_description: "Unsupported code_challenge_method. Supported: S256",
    };
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) {
    return {
      ok: false,
      error: "invalid_request",
      error_description: "Malformed code_challenge",
    };
  }

  if (!validateRedirectUri(redirectUri)) {
    return {
      ok: false,
      error: "invalid_request",
      error_description: "Invalid redirect_uri format or insecure scheme",
    };
  }

  const client = await oauthRepository.getClient(clientId);
  if (!client) {
    return {
      ok: false,
      error: "invalid_client",
      error_description:
        "Client not registered. Please register your client first.",
    };
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return {
      ok: false,
      error: "invalid_request",
      error_description: "redirect_uri is not registered for this client",
    };
  }

  const state = text(params.state);
  return {
    ok: true,
    client,
    request: {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: (text(params.scope) ?? "admin").slice(0, 200),
      ...(state ? { state: state.slice(0, 1024) } : {}),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    },
  };
}

/** Opaque form of a request, carried by the consent page URL. */
export function encodeAuthorizationRequest(
  request: AuthorizationRequest | OAuthParams,
): string {
  return Buffer.from(JSON.stringify(request)).toString("base64url");
}

export function decodeAuthorizationRequest(
  encoded: string,
): Record<string, unknown> | null {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Issues a single-use code for `userId` and returns the client redirect. */
export async function approveAuthorizationRequest(
  request: AuthorizationRequest,
  userId: string,
): Promise<string> {
  const code = generateSecureAuthCode();
  await oauthRepository.setAuthCode(code, {
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    scope: request.scope,
    user_id: userId,
    code_challenge: request.code_challenge,
    code_challenge_method: request.code_challenge_method,
    expires_at: Date.now() + AUTH_CODE_TTL_MS,
  });
  const redirectUrl = new URL(request.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (request.state) {
    redirectUrl.searchParams.set("state", request.state);
  }
  return redirectUrl.toString();
}

/** RFC 6749 §4.1.2.1: tells the client the user refused. */
export function denyAuthorizationRequest(
  request: AuthorizationRequest,
): string {
  const redirectUrl = new URL(request.redirect_uri);
  redirectUrl.searchParams.set("error", "access_denied");
  redirectUrl.searchParams.set(
    "error_description",
    "The user denied the authorization request",
  );
  if (request.state) {
    redirectUrl.searchParams.set("state", request.state);
  }
  return redirectUrl.toString();
}
