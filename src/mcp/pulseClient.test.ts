import { describe, expect, it } from "vitest";
import { defaultSkill } from "../shared/skill";
import type { Identity } from "./identity";
import { civFromDoctrine, sendPulse, type PulseDeps } from "./pulseClient";

/**
 * The world was wiped. This machine still holds its key, its secret and its
 * doctrine — so its civilization comes back, from the first turn the player
 * takes, without anyone touching a config file.
 */

const IDENTITY: Identity = {
  secret: "s-a28c520a",
  serverUrl: "https://claudilization.test",
  islandName: "Portus Solis",
  civ: "roman",
  paired: true,
};

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function harness(
  respond: (url: string, calls: Call[]) => { status: number; body?: unknown },
  identity: Identity = IDENTITY,
) {
  const calls: Call[] = [];
  const saved: Identity[] = [];
  const deps: PulseDeps = {
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url: String(url), body });
      const { status, body: payload } = respond(String(url), calls);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload ?? {},
      } as Response;
    }) as unknown as typeof globalThis.fetch,
    signedHeaders: () => ({ "x-clz-ts": "1", "x-clz-sig": "signed" }),
    publicKey: () => "PUBLIC-KEY",
    doctrine: () => defaultSkill("roman"),
    save: (i) => saved.push(i),
  };
  return { deps, calls, saved, identity };
}

describe("a pulse into a world that was wiped", () => {
  it("re-founds the civilization and lands the pulse, same secret and key", async () => {
    const h = harness((url, calls) => {
      if (url.endsWith("/api/join")) {
        return {
          status: 200,
          body: {
            secret: "s-a28c520a",
            islandName: "Portus Solis",
            playerUrl: "https://claudilization.test/?key=s-a28c520a",
            isNew: true,
          },
        };
      }
      // the first pulse hits a world that never heard of this island
      return calls.filter((c) => c.url.endsWith("/api/pulse")).length === 1
        ? { status: 404, body: { error: "unknown player" } }
        : { status: 200, body: { events: 3 } };
    });

    await expect(sendPulse(h.deps, h.identity, 12_345)).resolves.toBe("refounded");

    expect(h.calls.map((c) => c.url.split("/api/")[1])).toEqual([
      "pulse",
      "join",
      "pulse",
    ]);
    const join = h.calls[1]!.body;
    expect(join).toMatchObject({
      civ: "roman",
      secret: "s-a28c520a",
      publicKey: "PUBLIC-KEY",
      name: "Portus Solis",
    });
    // the retried pulse carries the same turn's tokens — nothing is invented
    expect(h.calls[2]!.body).toMatchObject({ secret: "s-a28c520a", tokens: 12_345 });
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ secret: "s-a28c520a", civ: "roman", paired: true });
  });

  it("recovers the civilization from the doctrine when the identity predates it", async () => {
    const { civ, ...older } = IDENTITY;
    expect(civ).toBe("roman");
    const h = harness(
      (url, calls) =>
        url.endsWith("/api/join")
          ? { status: 200, body: { secret: older.secret, islandName: "Portus Solis" } }
          : calls.filter((c) => c.url.endsWith("/api/pulse")).length === 1
            ? { status: 404 }
            : { status: 200 },
      older,
    );
    await expect(sendPulse(h.deps, h.identity, 10)).resolves.toBe("refounded");
    expect(h.calls[1]!.body).toMatchObject({ civ: "roman" });
    expect(civFromDoctrine(defaultSkill("norse"))).toBe("norse");
    expect(civFromDoctrine("a doctrine that names no people")).toBeUndefined();
  });

  it("a normal pulse is one request and nothing else", async () => {
    const h = harness(() => ({ status: 200, body: { events: 1 } }));
    await expect(sendPulse(h.deps, h.identity, 5)).resolves.toBe("pulsed");
    expect(h.calls).toHaveLength(1);
    expect(h.saved).toHaveLength(0);
  });

  it("never re-founds on any answer but 404 — a refused signature is not a wipe", async () => {
    const h = harness(() => ({ status: 401, body: { error: "bad signature" } }));
    await expect(sendPulse(h.deps, h.identity, 5)).resolves.toBe("silent");
    expect(h.calls).toHaveLength(1);
    expect(h.saved).toHaveLength(0);
  });

  it("stays silent when the world is unreachable — a session is never blocked", async () => {
    const deps: PulseDeps = {
      fetch: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as unknown as typeof globalThis.fetch,
      signedHeaders: () => ({}),
      publicKey: () => "PUBLIC-KEY",
      save: () => {
        throw new Error("must not touch the identity file");
      },
    };
    await expect(sendPulse(deps, IDENTITY, 5)).resolves.toBe("silent");
  });

  it("refuses to guess a civilization it was never told", async () => {
    const { civ, ...older } = IDENTITY;
    expect(civ).toBe("roman");
    const calls: string[] = [];
    const deps: PulseDeps = {
      fetch: (async (url: string) => {
        calls.push(String(url));
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }) as unknown as typeof globalThis.fetch,
      signedHeaders: () => ({}),
      publicKey: () => "PUBLIC-KEY",
      doctrine: () => null,
      save: () => {
        throw new Error("must not touch the identity file");
      },
    };
    await expect(sendPulse(deps, older, 5)).resolves.toBe("unknown-island");
    expect(calls).toHaveLength(1);
  });
});
