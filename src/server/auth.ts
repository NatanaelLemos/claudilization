import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { canonicalMessage, SIGNATURE_WINDOW_SECONDS } from "../shared/signing";

/**
 * Verifies that a mutating request was signed by the island's paired Claude.
 * The signature covers timestamp, method, path, and the raw body, so a leaked
 * player URL can watch but never edit, and captured requests expire.
 */
export function verifyOwner(input: {
  publicKeyPem: string;
  ts: string | undefined;
  sig: string | undefined;
  method: string;
  path: string;
  body: string;
  /** unix seconds; injectable for tests */
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.ts || !input.sig) {
    return { ok: false, reason: "this island answers only to its paired Claude" };
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ts = Number(input.ts);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: "signature expired" };
  }
  try {
    const message = Buffer.from(
      canonicalMessage(input.ts, input.method, input.path, input.body),
    );
    const ok = cryptoVerify(
      null,
      message,
      createPublicKey(input.publicKeyPem),
      Buffer.from(input.sig, "base64"),
    );
    return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
  } catch {
    return { ok: false, reason: "signature unreadable" };
  }
}
