/**
 * The owner handshake's pure half — the canonical string both sides sign and
 * verify. No crypto imports here so the browser bundle can stay clean; the
 * key handling lives in src/mcp/keys.ts (sign) and src/server/auth.ts (verify).
 */
export const SIGNATURE_WINDOW_SECONDS = 300;

export function canonicalMessage(
  ts: number | string,
  method: string,
  path: string,
  body: string,
): string {
  return `claudilization-v1\n${ts}\n${method.toUpperCase()}\n${path}\n${body}`;
}
