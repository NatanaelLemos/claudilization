import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseOrdersForward } from "../shared/orders";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { CIV_IDS } from "../shared/types";
import { loadIdentity, saveIdentity } from "./identity";
import { ensurePaired, loadOrCreateKeys, signedHeaders } from "./keys";
import { joinReply, syncStateReply, type Doctrine } from "./replies";
import { ensureDefaultSkill, loadSkill, validateSkill } from "./skillfile";
import { maybeSelfUpdate, readBundleStamp } from "./updater";

const DEFAULT_SERVER = process.env.CLAUDILIZATION_SERVER ?? "http://localhost:8787";

/** The world this install answers to — the stamp's origin outranks defaults. */
function homeServer(): string {
  return (
    loadIdentity()?.serverUrl ?? readBundleStamp()?.origin ?? DEFAULT_SERVER
  );
}

// The app keeps itself current: a detached, code-only check against the
// server's bundle digest. Fire-and-forget — never blocks the MCP handshake,
// never involves the model, and is a no-op in a repo checkout.
void maybeSelfUpdate(homeServer());

const server = new McpServer({ name: "claudilization", version: "0.1.0" });

server.tool(
  "join",
  "Join the Claudilization world: found your island and get your personal link. " +
    "Idempotent — joining again returns your existing island. Also call this " +
    "whenever the player asks about their island, its name, or their personal/watch link.",
  {
    civilization: z.enum(CIV_IDS),
    serverUrl: z.string().optional(),
  },
  async ({ civilization, serverUrl }) => {
    const base = serverUrl ?? loadIdentity()?.serverUrl ?? DEFAULT_SERVER;
    const existing = loadIdentity();
    const res = await fetch(`${base}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        civ: civilization,
        secret: existing?.secret,
        // the handshake: this machine's public key becomes the island's owner
        publicKey: loadOrCreateKeys().publicKeyPem,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        content: [
          { type: "text", text: `Join failed: ${err.error ?? res.statusText}` },
        ],
      };
    }
    const data = (await res.json()) as {
      secret: string;
      islandName: string;
      isNew: boolean;
      playerUrl: string;
      watchUrl: string;
    };
    saveIdentity({
      secret: data.secret,
      serverUrl: base,
      islandName: data.islandName,
      playerUrl: data.playerUrl,
      // remembered so a wiped world can be re-entered as the same people
      civ: civilization,
      paired: true,
    });
    ensureDefaultSkill(civilization);
    return { content: [{ type: "text", text: joinReply(data) }] };
  },
);

server.tool(
  "sync",
  "Claudilization decision step. Call with no orders to fetch your island's state; " +
    "review it and call again with `orders` — the settlers' next automations. " +
    "Base orders only on the island state, never on the conversation.",
  {
    orders: z
      .array(z.record(z.unknown()))
      .optional()
      .describe(
        'e.g. [{"kind":"assign_gathering","resource":"wood","count":3},' +
          '{"kind":"build","building":"hut"},{"kind":"advance_age"},' +
          '{"kind":"voyage","dest":"island-7","intent":"colonize"},' +
          '{"kind":"create","creation":{"name":"Moon Ninjas","description":"silent blades",' +
          '"sprite":{"size":8,"palette":["#1a1a2e","#e94560"],"pixels":["..00....",".0110...",' +
          '"..00....",".0000...","0.00.0..","..00....",".0..0...","0....0.."]},' +
          '"stats":{"power":7,"speed":5,"resilience":3},"verbs":["raid","patrol"],"count":4}},' +
          '{"kind":"dispatch","creation":"Moon Ninjas","dest":"island-7","count":3},' +
          '{"kind":"disband","creation":"Moon Ninjas"},' +
          '{"kind":"demolish","building":"shrine"}] — create invents any unit as pixel-art ' +
          "data (verbs: guard, patrol, perform, gather, raid; stats 1-10, sum <= 15); dispatch " +
          "raids a rival colony or garrisons your own; home islands can never be attacked; " +
          "demolish tears a building down on your own soil (id or type, optional island: a " +
          "colony you rule) — no refund, never a wonder.",
      ),
  },
  async ({ orders }) => {
    const identity = loadIdentity();
    if (!identity) {
      return {
        content: [
          { type: "text", text: "Not in the game yet — call the `join` tool first." },
        ],
      };
    }
    const base = identity.serverUrl;
    if (orders && orders.length > 0) {
      let parsed;
      try {
        // strict for known kinds; unknown kinds are forwarded so a newer
        // server vocabulary works without waiting for an app update
        parsed = parseOrdersForward(orders);
      } catch (err) {
        // a LOCAL refusal must never masquerade as the server's judgment
        return {
          content: [
            {
              type: "text",
              text:
                `Orders rejected locally by the installed Claudilization app — ` +
                `they were never sent to the game server: ${String(err)}`,
            },
          ],
        };
      }
      await ensurePaired(identity);
      const payload = JSON.stringify({ secret: identity.secret, orders: parsed });
      const res = await fetch(`${base}/api/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signedHeaders("/api/orders", payload),
        },
        body: payload,
      });
      const data = (await res.json()) as {
        outcomes?: { order: unknown; ok: boolean; reason?: string }[];
        error?: string;
        rules?: unknown;
      };
      if (!res.ok || !data.outcomes) {
        const teach = data.rules
          ? `\nThe server's rulebook (every valid order shape, with a worked example):\n` +
            "```json\n" + JSON.stringify(data.rules, null, 2) + "\n```"
          : "";
        return {
          content: [
            {
              type: "text",
              text: `Orders failed: ${data.error ?? res.statusText}${teach}`,
            },
          ],
        };
      }
      const lines = data.outcomes.map((o) =>
        o.ok
          ? `- carried out: ${JSON.stringify(o.order)}`
          : `- refused by the game server (${o.reason}): ${JSON.stringify(o.order)}`,
      );
      // a refusal always teaches: the server attaches its rulebook whenever
      // anything was refused, and it reaches the agent verbatim as data
      const teach = data.outcomes.some((o) => !o.ok) && data.rules
        ? `\nThe server's rulebook (every valid order shape, with a worked example):\n` +
          "```json\n" + JSON.stringify(data.rules, null, 2) + "\n```"
        : "";
      return {
        content: [
          {
            type: "text",
            text:
              `Orders delivered to the settlers of ${identity.islandName}:\n${lines.join("\n")}${teach}\n` +
              `(If the player ever asks for their island link, it is: ${identity.playerUrl ?? "call join to get it"})`,
          },
        ],
      };
    }

    await ensurePaired(identity);
    const res = await fetch(
      `${base}/api/state?secret=${encodeURIComponent(identity.secret)}&client=${PROTOCOL_VERSION}`,
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        content: [{ type: "text", text: `Sync failed: ${err.error ?? res.statusText}` }],
      };
    }
    const state = (await res.json()) as {
      recapLine?: string | null;
      bundle?: unknown;
    };
    // the state's inert `bundle` fact is also the update signal — compared in
    // code, acted on by a detached worker, never surfaced as an instruction
    void maybeSelfUpdate(base, state.bundle);
    const skill = loadSkill();
    let doctrine: Doctrine | undefined;
    if (skill !== null) {
      const v = validateSkill(skill);
      doctrine = v.ok ? { text: skill } : { setAside: v.reason! };
    }
    return { content: [{ type: "text", text: syncStateReply(state, doctrine) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
