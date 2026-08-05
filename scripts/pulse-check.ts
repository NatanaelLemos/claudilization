/**
 * End-to-end check of the loop that plays this game: a signed pulse from this
 * machine's Claude Code identity, and the island state on either side of it.
 *
 *   npx tsx scripts/pulse-check.ts [serverUrl] [tokens]
 *
 * Reads the same identity and key the Stop hook uses, so a pass here means the
 * real hook would land too. Sends numbers only, exactly like the hook.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { signedHeaders } from "../src/mcp/keys";

interface Identity {
  secret: string;
  serverUrl: string;
  islandName?: string;
}

interface StateShot {
  island?: { name?: string; age?: string; dormant?: boolean; workPoints?: number };
  workPoints?: number;
  age?: string;
  population?: number;
  settlers?: unknown[];
}

function identity(): Identity {
  const file = join(homedir(), ".claudilization", "identity.json");
  return JSON.parse(readFileSync(file, "utf8")) as Identity;
}

async function shot(base: string, secret: string): Promise<StateShot | null> {
  const res = await fetch(`${base}/api/state?secret=${encodeURIComponent(secret)}`);
  if (!res.ok) return null;
  return (await res.json()) as StateShot;
}

function describe(label: string, state: StateShot | null): void {
  if (!state) {
    console.log(`${label}: no state`);
    return;
  }
  const island = state.island ?? {};
  console.log(
    `${label}: island=${island.name ?? "?"} age=${island.age ?? state.age ?? "?"} ` +
      `dormant=${island.dormant ?? "?"} workPoints=${(island.workPoints ?? state.workPoints ?? 0).toFixed?.(1)} ` +
      `population=${state.population ?? state.settlers?.length ?? "?"}`,
  );
}

async function main(): Promise<void> {
  const id = identity();
  const base = process.argv[2] ?? id.serverUrl;
  const tokens = Number(process.argv[3] ?? 25_000);

  const before = await shot(base, id.secret);
  describe("before", before);

  const payload = JSON.stringify({ secret: id.secret, tokens });
  const res = await fetch(`${base}/api/pulse`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders("/api/pulse", payload) },
    body: payload,
  });
  const body = await res.text();
  console.log(`pulse: ${res.status} ${body.slice(0, 300)}`);

  await new Promise((resolve) => setTimeout(resolve, 2000));
  const after = await shot(base, id.secret);
  describe("after", after);

  if (!res.ok) process.exitCode = 1;
}

void main();
