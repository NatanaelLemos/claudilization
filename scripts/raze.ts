/**
 * Apply a raze list: one signed demolish order per condemned building, in
 * batches the order vocabulary accepts (10 at a time). Reads the list written
 * by scripts/audit-buildings.ts, never invents a target, and reports every
 * outcome the server judged.
 *
 *   npx tsx scripts/raze.ts notes/evidence/2026-08-12-raze-list.json [--dry]
 */
import { readFileSync } from "node:fs";
import { loadIdentity } from "../src/mcp/identity";
import { ensurePaired, signedHeaders } from "../src/mcp/keys";

interface Condemned {
  island: string;
  id: string;
  type: string;
  pos: { x: number; y: number };
  why: string[];
}

const BATCH = 10;

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error("usage: raze.ts <raze-list.json> [--dry]");
  const dry = process.argv.includes("--dry");
  const list = JSON.parse(readFileSync(path, "utf8")) as Condemned[];
  const identity = loadIdentity();
  if (!identity) throw new Error("no identity — this machine is not in the game");
  await ensurePaired(identity);

  const orders = list.map((c) => ({
    kind: "demolish" as const,
    building: c.id,
    island: c.island,
  }));
  console.log(`${orders.length} condemned buildings across ${new Set(list.map((c) => c.island)).size} islands`);
  if (dry) {
    for (const o of orders) console.log(`  would raze ${o.building} on ${o.island}`);
    return;
  }

  let ok = 0;
  let refused = 0;
  for (let i = 0; i < orders.length; i += BATCH) {
    const batch = orders.slice(i, i + BATCH);
    const payload = JSON.stringify({ secret: identity.secret, orders: batch });
    const res = await fetch(`${identity.serverUrl}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signedHeaders("/api/orders", payload),
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as {
      error?: string;
      outcomes?: { ok: boolean; reason?: string; order: { building: string; island?: string } }[];
    };
    if (!res.ok || !data.outcomes) {
      console.log(`batch ${i / BATCH + 1}: HTTP ${res.status} ${data.error ?? ""}`);
      refused += batch.length;
      continue;
    }
    for (const o of data.outcomes) {
      if (o.ok) ok++;
      else refused++;
      console.log(
        `  ${o.ok ? "razed" : "REFUSED"} ${o.order.building} on ${o.order.island}` +
          (o.ok ? "" : ` — ${o.reason}`),
      );
    }
  }
  console.log(`razed ${ok}, refused ${refused}`);
}

void main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
