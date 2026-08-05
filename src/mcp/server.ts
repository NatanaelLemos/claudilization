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

const DEFAULT_SERVER = process.env.CLAUDILIZATION_SERVER ?? "http://localhost:8787";

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
          '{"kind":"disband","creation":"Moon Ninjas"}] — create invents any unit as pixel-art ' +
          "data (verbs: guard, patrol, perform, gather, raid; stats 1-10, sum <= 15); dispatch " +
          "raids a rival colony or garrisons your own; home islands can never be attacked.",
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
        return {
          content: [{ type: "text", text: `Orders rejected: ${String(err)}` }],
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
      };
      if (!res.ok || !data.outcomes) {
        return {
          content: [{ type: "text", text: `Orders failed: ${data.error ?? res.statusText}` }],
        };
      }
      const lines = data.outcomes.map((o) =>
        o.ok
          ? `- carried out: ${JSON.stringify(o.order)}`
          : `- refused (${o.reason}): ${JSON.stringify(o.order)}`,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `Orders delivered to the settlers of ${identity.islandName}:\n${lines.join("\n")}\n` +
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
    const state = (await res.json()) as { recapLine?: string | null };
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
