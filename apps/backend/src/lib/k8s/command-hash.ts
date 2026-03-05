import crypto from 'node:crypto';

export function computeCommandHash(command: string, args: string[]): string {
  const normalized = JSON.stringify({ command, args: [...args].sort() });
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 8);
}
