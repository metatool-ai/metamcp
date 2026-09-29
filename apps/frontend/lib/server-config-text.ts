/**
 * Text forms of an MCP server's arguments, environment and headers, as
 * edited in the server forms. Both directions must round-trip: saving a form
 * after changing only the description used to split arguments on every
 * space ("/data/My Files" became two arguments) and to trim values.
 */

const PLAIN_ARG = /^[\w@%+=:,./-]+$/;

/** Arguments as a shell-like line: arguments with spaces are quoted. */
export function formatArgs(args: readonly string[]): string {
  return args
    .map((arg) =>
      PLAIN_ARG.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`,
    )
    .join(" ");
}

/**
 * Arguments of a shell-like line: whitespace separates arguments, '...' and
 * "..." group words, a backslash escapes a space, a quote or a backslash.
 * Nothing else is interpreted (no variables, globs, comments or operators).
 */
export function parseArgs(text: string): string[] {
  const args: string[] = [];
  let current = "";
  let inArg = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      const next = text.charAt(i + 1);
      if (char === '"') {
        quote = null;
      } else if (char === "\\" && (next === '"' || next === "\\")) {
        current += next;
        i++;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inArg = true;
    } else if (char === "\\" && /[\s'"\\]/.test(text.charAt(i + 1))) {
      // Escapes a separator or a quote; any other backslash is literal
      // (Windows paths, regular expressions)
      current += text.charAt(i + 1);
      inArg = true;
      i++;
    } else if (/\s/.test(char)) {
      if (inArg) {
        args.push(current);
        current = "";
        inArg = false;
      }
    } else {
      current += char;
      inArg = true;
    }
  }
  // An unterminated quote keeps the rest of the line as typed
  if (inArg) args.push(current);
  return args;
}

/** KEY=VALUE lines (values kept as typed, including spaces). */
export function formatKeyValueLines(
  record: Readonly<Record<string, string>>,
): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/**
 * Parses KEY=VALUE lines. The key is trimmed; the value is kept exactly as
 * typed after the first "=" (only a Windows line ending is removed). Lines
 * without "=" are ignored.
 */
export function parseKeyValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key) {
      result[key] = line.slice(separator + 1);
    }
  }
  return result;
}
