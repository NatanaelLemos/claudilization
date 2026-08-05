/**
 * This machine's half of the owner handshake: an Ed25519 keypair kept at
 * ~/.claudilization/key.pem (0600). The public key pairs with the island at
 * join; every mutating request is signed with the private key, so the secret
 * in a shared player URL can watch the island but never command it.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalMessage } from "../shared/signing";
import { saveIdentity, type Identity } from "./identity";

const KEY_FILE = join(homedir(), ".claudilization", "key.pem");

export function loadOrCreateKeys(): { privateKeyPem: string; publicKeyPem: string } {
  if (!existsSync(KEY_FILE)) {
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    mkdirSync(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(KEY_FILE, pem, { mode: 0o600 });
  }
  chmodSync(dirname(KEY_FILE), 0o700);
  chmodSync(KEY_FILE, 0o600);
  const privateKeyPem = readFileSync(KEY_FILE, "utf8");
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "pem",
  }) as string;
  return { privateKeyPem, publicKeyPem };
}

/** Signature headers for a mutating POST whose exact raw body is `body`. */
export function signedHeaders(path: string, body: string): Record<string, string> {
  const { privateKeyPem } = loadOrCreateKeys();
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = cryptoSign(
    null,
    Buffer.from(canonicalMessage(ts, "POST", path, body)),
    createPrivateKey(privateKeyPem),
  ).toString("base64");
  return { "x-clz-ts": ts, "x-clz-sig": sig };
}

/**
 * Complete the handshake once for identities that predate it. Safe to call
 * often: a no-op when already marked paired, silent when the server is away.
 */
export async function ensurePaired(identity: Identity): Promise<void> {
  if (identity.paired) return;
  const { publicKeyPem } = loadOrCreateKeys();
  try {
    const res = await fetch(`${identity.serverUrl}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: identity.secret, publicKey: publicKeyPem }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) saveIdentity({ ...identity, paired: true });
  } catch {
    // unreachable server — try again next time; the game never breaks a session
  }
}
