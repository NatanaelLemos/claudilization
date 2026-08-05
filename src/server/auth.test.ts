import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalMessage, SIGNATURE_WINDOW_SECONDS } from "../shared/signing";
import { verifyOwner } from "./auth";

function makeKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function signWith(privateKeyPem: string, ts: string, path: string, body: string) {
  return cryptoSign(
    null,
    Buffer.from(canonicalMessage(ts, "POST", path, body)),
    createPrivateKey(privateKeyPem),
  ).toString("base64");
}

const NOW = 1_700_000_000;

describe("the owner handshake", () => {
  const keys = makeKeys();
  const body = '{"secret":"s-1","name":"Nova"}';

  it("accepts a fresh, correctly signed request", () => {
    const ts = String(NOW);
    const result = verifyOwner({
      publicKeyPem: keys.publicKeyPem,
      ts,
      sig: signWith(keys.privateKeyPem, ts, "/api/rename", body),
      method: "POST",
      path: "/api/rename",
      body,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered body — the signature covers every byte", () => {
    const ts = String(NOW);
    const result = verifyOwner({
      publicKeyPem: keys.publicKeyPem,
      ts,
      sig: signWith(keys.privateKeyPem, ts, "/api/rename", body),
      method: "POST",
      path: "/api/rename",
      body: '{"secret":"s-1","name":"Stolen"}',
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects a replayed signature after the freshness window", () => {
    const ts = String(NOW);
    const result = verifyOwner({
      publicKeyPem: keys.publicKeyPem,
      ts,
      sig: signWith(keys.privateKeyPem, ts, "/api/rename", body),
      method: "POST",
      path: "/api/rename",
      body,
      now: NOW + SIGNATURE_WINDOW_SECONDS + 1,
    });
    expect(result).toEqual({ ok: false, reason: "signature expired" });
  });

  it("rejects another Claude's key outright", () => {
    const intruder = makeKeys();
    const ts = String(NOW);
    const result = verifyOwner({
      publicKeyPem: keys.publicKeyPem,
      ts,
      sig: signWith(intruder.privateKeyPem, ts, "/api/rename", body),
      method: "POST",
      path: "/api/rename",
      body,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects bare requests with no signature at all", () => {
    const result = verifyOwner({
      publicKeyPem: keys.publicKeyPem,
      ts: undefined,
      sig: undefined,
      method: "POST",
      path: "/api/orders",
      body,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});
