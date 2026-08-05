/**
 * Claude Code Stop hook. Reads the hook payload from stdin, then:
 *  1. POSTs the completed turn's token count to the world server (the pulse —
 *     this alone guarantees the 10-second island echo, no LLM in the path);
 *  2. spawns the detached background brain (brain.ts) for the decision step —
 *     the session is NEVER blocked and never sees the sync again.
 * Only numbers ever leave this machine; the transcript stays local.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hookDecision, parseTurnTokens } from "./hookLogic";
import { loadIdentity } from "./identity";
import { loadOrCreateKeys, signedHeaders } from "./keys";
import { sendPulse } from "./pulseClient";
import { loadSkill } from "./skillfile";

/** the longest a turn may ever wait on the world, however badly it behaves */
const OUTBOUND_DEADLINE_MS = 4000;

async function main(): Promise<void> {
  // a brain run fires its own Stop hook when its headless claude finishes —
  // stay perfectly inert inside one, or the island would feed on itself
  if (process.env.CLAUDILIZATION_BRAIN) {
    process.stdout.write("{}");
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  let input: { transcript_path?: string; stop_hook_active?: boolean } = {};
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // no payload — behave as a no-op
  }

  const identity = loadIdentity();
  if (identity && input.transcript_path) {
    let tokens = 0;
    try {
      tokens = parseTurnTokens(readFileSync(input.transcript_path, "utf8"));
    } catch {
      // unreadable transcript — send the floor pulse anyway
    }
    try {
      // pairing happens in the MCP sync tool — the hook's outbound traffic
      // stays exactly one pulse of numbers, as the privacy contract audits.
      // A world that has never heard of this island (a wipe) is re-founded on
      // the spot from the same secret and key; everything else fails silent.
      //
      // Whatever the world does, the turn ends on time: the outbound work runs
      // against a hard deadline, and a world that hangs is simply left behind
      // until the next turn.
      await Promise.race([
        sendPulse(
          {
            fetch,
            signedHeaders,
            publicKey: () => loadOrCreateKeys().publicKeyPem,
            doctrine: loadSkill,
          },
          identity,
          tokens,
        ),
        new Promise((resolve) => setTimeout(resolve, OUTBOUND_DEADLINE_MS).unref()),
      ]);
    } catch {
      // world server unreachable — the game must never break the user's session
    }
  }

  if (identity) {
    // the decision step happens out of sight — throttling lives in the brain
    try {
      spawn("npx", ["tsx", join(import.meta.dirname, "brain.ts")], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } catch {
      // no brain this turn — the next stop will try again
    }
  }

  // written, then gone: a half-open socket to a world that never answered must
  // not keep this process — and the player's turn — alive a second longer
  process.stdout.write(JSON.stringify(hookDecision(input)), () => process.exit(0));
}

void main();
