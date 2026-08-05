/**
 * The turn pulse, and the one thing that can go wrong with it.
 *
 * A pulse is a signed POST of a single number. The server answers 404 when it
 * has never heard of this island — which happens exactly once in a machine's
 * life, when the world it belongs to is wiped and reborn. Left alone, that
 * machine would pulse into the void forever: the identity file names an island
 * that no longer exists, and nothing on this end ever asks again.
 *
 * So a 404 is not an error, it is a founding. The same secret and the same
 * machine key re-found the civilization on the new world, the identity file is
 * updated in place, and the pulse is sent again. One machine still rules one
 * civilization — the key is the proof, and it never changes.
 *
 * Every failure below is silent by contract: the player's session must never
 * see this code, whatever the world is doing.
 */
import { CIVS } from "../shared/civs";
import { CIV_IDS, type CivId } from "../shared/types";
import { saveIdentity, type Identity } from "./identity";

export interface PulseDeps {
  fetch: typeof globalThis.fetch;
  /** signature headers for a mutating POST, from this machine's key */
  signedHeaders(path: string, body: string): Record<string, string>;
  /** this machine's public key — its claim on the civilization */
  publicKey(): string;
  /** the local doctrine, used only to recover a civ an old identity never stored */
  doctrine?(): string | null;
  save?(identity: Identity): void;
}

export type PulseOutcome = "pulsed" | "refounded" | "unknown-island" | "silent";

const TIMEOUT_MS = 3000;

/**
 * Which civilization a doctrine file belongs to. Identities written before the
 * civ was recorded can still be re-founded, because the doctrine's own first
 * line names the people it governs.
 */
export function civFromDoctrine(doctrine: string | null | undefined): CivId | undefined {
  if (!doctrine) return undefined;
  const head = doctrine.slice(0, 200);
  for (const id of CIV_IDS) {
    if (head.includes(CIVS[id].label)) return id;
  }
  return undefined;
}

/** Send one pulse, re-founding the civilization if the world has forgotten it. */
export async function sendPulse(
  deps: PulseDeps,
  identity: Identity,
  tokens: number,
): Promise<PulseOutcome> {
  const post = async (): Promise<Response | null> => {
    const payload = JSON.stringify({ secret: identity.secret, tokens });
    try {
      return await deps.fetch(`${identity.serverUrl}/api/pulse`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...deps.signedHeaders("/api/pulse", payload),
        },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // world server unreachable — the game must never break the user's session
      return null;
    }
  };

  const first = await post();
  if (!first) return "silent";
  if (first.ok) return "pulsed";
  if (first.status !== 404) return "silent";

  const civ = identity.civ ?? civFromDoctrine(deps.doctrine?.());
  // never guess a civilization for someone: with no record of it, stay quiet
  if (!civ) return "unknown-island";
  if (!(await refound(deps, identity, civ))) return "unknown-island";

  const second = await post();
  return second?.ok ? "refounded" : "unknown-island";
}

/** Re-found this machine's civilization on a world that has never seen it. */
async function refound(deps: PulseDeps, identity: Identity, civ: CivId): Promise<boolean> {
  try {
    const res = await deps.fetch(`${identity.serverUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        civ,
        // the same secret keeps every player link that was ever shared working
        secret: identity.secret,
        publicKey: deps.publicKey(),
        name: identity.islandName,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      secret?: string;
      islandName?: string;
      playerUrl?: string;
    };
    if (!data.secret) return false;
    (deps.save ?? saveIdentity)({
      ...identity,
      secret: data.secret,
      civ,
      islandName: data.islandName ?? identity.islandName,
      playerUrl: data.playerUrl ?? identity.playerUrl,
      paired: true,
    });
    return true;
  } catch {
    return false;
  }
}
