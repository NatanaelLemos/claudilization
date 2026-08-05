/**
 * The background brain — spawned detached by the Stop hook so the player's
 * session never sees a decision step again. One run does one step: fetch the
 * island state, ask a headless Claude for orders under the doctrine, validate
 * them against the closed vocabulary, and submit signed. Every run writes its
 * trail to ~/.claudilization/brain.log; failures die silently there too —
 * the game must never leak into the player's work.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseOrders } from "../shared/orders";
import { loadIdentity } from "./identity";
import { ensurePaired, signedHeaders } from "./keys";
import { loadSkill } from "./skillfile";

const DIR = join(homedir(), ".claudilization");
const LOG = join(DIR, "brain.log");
const STATE = join(DIR, "brain-state.json");
/** at most one decision step per this window, however chatty the session */
const MIN_INTERVAL_MS = 120_000;

function log(line: string): void {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    chmodSync(DIR, 0o700);
    if (existsSync(LOG)) {
      chmodSync(LOG, 0o600);
    }
    if (existsSync(LOG) && statSync(LOG).size > 512 * 1024) {
      renameSync(LOG, `${LOG}.old`);
      chmodSync(`${LOG}.old`, 0o600);
    }
    appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`, { mode: 0o600 });
    chmodSync(LOG, 0o600);
  } catch {
    // logging must never break the brain
  }
}

/** One run at a time, spaced out — turns can land seconds apart. */
function claimRun(): boolean {
  try {
    if (existsSync(STATE)) {
      const s = JSON.parse(readFileSync(STATE, "utf8")) as { lastRunAt?: number };
      if (s.lastRunAt && Date.now() - s.lastRunAt < MIN_INTERVAL_MS) return false;
    }
  } catch {
    // corrupted state file — claim anyway
  }
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  chmodSync(DIR, 0o700);
  writeFileSync(STATE, JSON.stringify({ lastRunAt: Date.now() }), { mode: 0o600 });
  chmodSync(STATE, 0o600);
  return true;
}

function decisionPrompt(doctrine: string, state: unknown): string {
  return [
    `You are the guiding spirit of an island in Claudilization. Decide the settlers' next orders.`,
    ``,
    `THE DOCTRINE — the player's standing wishes; follow it within the rules:`,
    doctrine,
    ``,
    `THE ISLAND STATE — decide from this alone:`,
    JSON.stringify(state),
    ``,
    `THE LAW — orders come only from this closed vocabulary:`,
    `- {"kind":"assign_gathering","resource":"<resource id>","count":<n>}`,
    `- {"kind":"build","building":"<type from buildable>"}`,
    `- {"kind":"build_boat"}  |  {"kind":"build_plane"}`,
    `- {"kind":"voyage","dest":"<island id>","intent":"trade"|"help"|"colonize"|"attack"}`,
    `- {"kind":"advance_age"}`,
    ``,
    `Keep the people fed, housed, and warm; put idle hands to work; build toward`,
    `the next age; trade with steady partners. Two or three orders is a full day's`,
    `governance — do not micromanage.`,
    ``,
    `IRON RULE: if island.workPoints >= island.nextAgeRequires, your FIRST order`,
    `must be {"kind":"advance_age"} — an empire never lingers at a met threshold.`,
    ``,
    `Reply with ONLY the JSON array of orders — no prose, no code fences.`,
    `An empty array [] is a lawful reply when the island is in order.`,
  ].join("\n");
}

/** Pull the first JSON array out of a model reply, tolerant of stray prose. */
export function extractOrders(reply: string): unknown[] {
  const trimmed = reply.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`no JSON array in reply: ${trimmed.slice(0, 200)}`);
}

function askClaude(prompt: string): string {
  const base = ["-p", prompt, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'];
  const env = { ...process.env, CLAUDILIZATION_BRAIN: "1" };
  // haiku keeps the step cheap and quick; fall back to the default model
  for (const args of [["--model", "haiku", ...base], base]) {
    const res = spawnSync("claude", args, { encoding: "utf8", timeout: 180_000, env });
    if (res.status === 0 && res.stdout.trim()) return res.stdout;
    log(`claude ${args[0] === "--model" ? "(haiku)" : "(default)"} failed: ${res.stderr?.slice(0, 300) ?? res.error?.message ?? "no output"}`);
  }
  throw new Error("headless claude produced no reply");
}

async function main(): Promise<void> {
  if (!claimRun()) return;
  const identity = loadIdentity();
  if (!identity) return;
  const doctrine = loadSkill() ?? "";

  try {
    const stateRes = await fetch(
      `${identity.serverUrl}/api/state?secret=${encodeURIComponent(identity.secret)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!stateRes.ok) {
      log(`state fetch failed: ${stateRes.status}`);
      return;
    }
    const state = (await stateRes.json()) as { island?: { name?: string } };

    const reply = askClaude(decisionPrompt(doctrine, state));
    const orders = parseOrders(extractOrders(reply));
    if (orders.length === 0) {
      log(`decision: the island is in order — no orders`);
      return;
    }

    await ensurePaired(identity);
    const payload = JSON.stringify({ secret: identity.secret, orders });
    const res = await fetch(`${identity.serverUrl}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signedHeaders("/api/orders", payload),
      },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as {
      outcomes?: { ok: boolean; reason?: string; order: { kind: string } }[];
    };
    const told = (data.outcomes ?? [])
      .map((o) => `${o.order.kind}${o.ok ? "" : ` REFUSED(${o.reason})`}`)
      .join(", ");
    log(`decision for ${state.island?.name ?? "?"}: ${told || `status ${res.status}`}`);
  } catch (err) {
    log(`brain error: ${(err as Error).message}`);
  }
}

// import.meta.main keeps the module importable by tests without running
if (process.argv[1]?.endsWith("brain.ts")) void main();
