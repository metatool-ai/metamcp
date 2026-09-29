/**
 * Pure helpers of the activity log (no database access): redaction of
 * details, field diffs, CSV cells and retention settings.
 */

const SENSITIVE_KEY =
  /(secret|token|password|passwd|authorization|bearer|api[-_]?key|credential|cookie)/i;
const MAX_STRING = 500;
const MAX_ITEMS = 100;

/**
 * Safety net: callers only pass names and non-secret values, but anything
 * under a key that looks sensitive is replaced, and sizes are bounded.
 */
export function redactDetails(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => redactDetails(item, depth + 1));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_ITEMS)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) &&
          (typeof item === "string" || typeof item === "number")
            ? "[redacted]"
            : redactDetails(item, depth + 1),
        ]),
    );
  }
  if (typeof value === "string" && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`;
  }
  return value;
}

/** `{ field: { from, to } }` for the fields that changed. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    if (!(field in after) || after[field] === undefined) continue;
    const from = before[field];
    const to = after[field];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[String(field)] = { from, to };
    }
  }
  return changes;
}

export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  // Spreadsheet formula injection: neutralise leading = + - @ (and tab / CR).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function activityRetentionDays(): number | null {
  const raw = process.env.ACTIVITY_LOG_RETENTION_DAYS;
  if (raw === undefined || raw.trim() === "") return 365;
  const days = Number(raw);
  // 0 (or a negative value) keeps entries forever.
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : null;
}
