/**
 * Refuses to run a production instance with the placeholder secrets of the
 * example configurations: they are public, so a quick start left unedited
 * would sign sessions with a known key, derive the key protecting stored
 * credentials from it, and create an administrator with a known password.
 * ALLOW_INSECURE_DEFAULTS=true downgrades these errors to warnings (for an
 * evaluation instance only).
 */

const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "your-super-secret-key-change-this-in-production",
  "change-me",
  "changeme",
  "change-this",
  "secret",
]);

const PLACEHOLDER_PASSWORDS: ReadonlySet<string> = new Set([
  "changeme",
  "change-me",
  "password",
  "admin",
  "admin123",
]);

export function isPlaceholderSecret(value: string | undefined): boolean {
  return value !== undefined && PLACEHOLDER_SECRETS.has(value.trim());
}

export function isPlaceholderPassword(value: string | undefined): boolean {
  return (
    value !== undefined && PLACEHOLDER_PASSWORDS.has(value.trim().toLowerCase())
  );
}

export function insecureDefaultsAllowed(): boolean {
  return process.env.ALLOW_INSECURE_DEFAULTS === "true";
}

/** Whether the placeholder checks apply (production instances). */
export function enforcesSecureDefaults(): boolean {
  return process.env.NODE_ENV === "production" && !insecureDefaultsAllowed();
}

export function insecureConfigurationErrors(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const errors: string[] = [];
  if (isPlaceholderSecret(env.BETTER_AUTH_SECRET)) {
    errors.push(
      "BETTER_AUTH_SECRET still has the value of the example configuration. Generate one (openssl rand -base64 32). If stored credentials are encrypted with a key derived from it, first set SECRETS_ENCRYPTION_KEY and restart once, so they are re-wrapped with it, then change BETTER_AUTH_SECRET.",
    );
  }
  return errors;
}

/** Exits the process on insecure production settings (see above). */
export function assertSecureConfiguration(): void {
  if ((process.env.BETTER_AUTH_SECRET ?? "").length < 32) {
    console.warn(
      "⚠️ BETTER_AUTH_SECRET is shorter than 32 characters. Generate a stronger one with: openssl rand -base64 32",
    );
  }
  if (process.env.NODE_ENV !== "production") return;
  const errors = insecureConfigurationErrors();
  if (errors.length === 0) return;
  const allowed = insecureDefaultsAllowed();
  for (const error of errors) {
    (allowed ? console.warn : console.error)(
      `${allowed ? "⚠️" : "❌"} ${error}`,
    );
  }
  if (allowed) {
    console.warn(
      "⚠️ ALLOW_INSECURE_DEFAULTS=true: starting anyway. Never do this on an instance holding real credentials.",
    );
    return;
  }
  console.error(
    "❌ Refusing to start with insecure settings (set ALLOW_INSECURE_DEFAULTS=true for a throwaway evaluation instance).",
  );
  // eslint-disable-next-line no-process-exit -- intentional: fail closed before serving anything
  process.exit(1);
}
