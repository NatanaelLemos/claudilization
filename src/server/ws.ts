import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { Balance } from "../shared/balance";
import { CIVS } from "../shared/civs";
import type { GameEvent, Island } from "../shared/types";
import { withBasePath } from "./basePath";
import { computeRecap } from "./recap";
import type { World } from "./world";

/**
 * Everything the hub ever asks of a connection. A `ws` WebSocket satisfies it
 * natively; the SSE+POST fallback (see `sse.ts`) implements the same shape, so
 * the world/island/events/chat/hello protocol lives in exactly one place and
 * neither transport can drift from the other.
 */
export interface HubSocket {
  /** 1 = OPEN, matching the WebSocket readyState constants. */
  readyState: number;
  send(data: string): void;
  on(event: "message", listener: (raw: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  close(): void;
}

const SOCKET_OPEN = 1;
const MAX_SOCKET_PAYLOAD_BYTES = 64 * 1024;
const MAX_SUBSCRIPTIONS = 64;

interface ClientState {
  socket: HubSocket;
  subscribed: Set<string>;
  secret?: string;
  islandId?: string;
}

/** Lightweight island summary every viewer gets for the whole ocean. */
function summary(island: Island, world: World) {
  return {
    id: island.id,
    name: island.name,
    civ: island.civ,
    // resolved through the ruler for colonies — the flown color, not the field
    color: world.colorOf(island),
    age: island.age,
    kind: island.kind,
    origin: island.origin,
    ownerId: island.ownerId,
    seed: island.seed,
    size: island.size,
    position: island.position,
    ruins: island.ruins,
    dormant: island.dormant,
    lastPulseAt: island.lastPulseAt,
    lastPulseSeq: island.lastPulseSeq,
    population: island.settlers.length,
    // the built world and the ships at sea are part of the map itself — every
    // viewer must see them, focused on the island or not, and across refreshes
    buildings: island.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      stage: b.stage,
      progress: b.progress,
      pos: b.pos,
      age: b.age,
    })),
    boats: island.boats.map((b) => ({
      id: b.id,
      pos: b.pos,
      state: b.state,
      craft: b.craft,
      // destination and intent are public knowledge (the feed announces every
      // departure) — the client uses them to stage skirmishes where raids land
      dest: b.dest,
      intent: b.intent,
    })),
    // player-invented creations are part of the visible world too: the specs
    // carry the pixel-art the client draws, the units and bands carry positions
    creationSpecs: (island.creationSpecs ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      sprite: s.sprite,
    })),
    creations: (island.creations ?? []).map((u) => ({
      id: u.id,
      specId: u.specId,
      pos: u.pos,
    })),
    creationBands: (island.creationBands ?? []).map((b) => ({
      id: b.id,
      specId: b.specId,
      pos: b.pos,
      state: b.state,
      units: b.units.length,
      dest: b.dest,
      intent: b.intent,
    })),
    time: world.time,
  };
}

/**
 * Real-time hub: world summaries for everyone, full island state only for
 * subscribed islands (interest scoping), events, chat, recaps.
 */
export class Hub {
  private clients = new Set<ClientState>();
  private lastSeen: Map<string, number>;

  constructor(
    private world: World,
    private balance: Balance,
    lastSeen: Map<string, number>,
  ) {
    this.lastSeen = lastSeen;
  }

  attach(server: Server, basePath = ""): void {
    const wss = new WebSocketServer({
      server,
      path: withBasePath(basePath, "/ws"),
      maxPayload: MAX_SOCKET_PAYLOAD_BYTES,
    });
    wss.on("connection", (socket) => this.attachSocket(socket));
  }

  /**
   * Adopt any socket-shaped connection — a real WebSocket or an SSE session —
   * as a client: greet it with the world, then run the shared protocol.
   */
  attachSocket(socket: HubSocket): void {
    const client: ClientState = { socket, subscribed: new Set() };
    this.clients.add(client);
    this.send(client, {
      type: "world",
      // the world's own clock: the sky is read from this, never from any one
      // island, so switching what you watch cannot move the sun
      time: this.world.time,
      daySeconds: this.balance.daySeconds,
      daylightShare: this.balance.daylightShare,
      catastrophe: this.world.catastrophe,
      islands: this.world.islands().map((i) => summary(i, this.world)),
    });
    socket.on("message", (raw: unknown) => {
      try {
        this.onMessage(client, JSON.parse(String(raw)));
      } catch {
        // malformed frame — ignore
      }
    });
    socket.on("close", () => this.clients.delete(client));
  }

  /** Live client count — transport-agnostic (tests and diagnostics). */
  get clientCount(): number {
    return this.clients.size;
  }

  private onMessage(client: ClientState, msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "hello": {
        if (typeof msg.secret !== "string") return;
        const island = this.world.islandOf(msg.secret);
        if (!island) return;
        client.secret = msg.secret;
        client.islandId = island.id;
        client.subscribed.add(island.id);
        const seen = this.lastSeen.get(msg.secret) ?? this.world.time;
        const recap = computeRecap(
          this.world.feed(island.id),
          seen,
          this.world.time,
          this.balance,
        );
        this.lastSeen.set(msg.secret, this.world.time);
        this.send(client, {
          type: "hello",
          islandId: island.id,
          islandName: island.name,
          recap,
        });
        break;
      }
      case "subscribe": {
        if (!Array.isArray(msg.islands)) return;
        client.subscribed = new Set(
          msg.islands
            .slice(0, MAX_SUBSCRIPTIONS)
            .filter((x): x is string => typeof x === "string" && x.length <= 128),
        );
        if (client.islandId) client.subscribed.add(client.islandId);
        for (const id of client.subscribed) {
          const island = this.world.island(id);
          if (island) this.send(client, { type: "island", island });
        }
        break;
      }
      case "chat": {
        // players only: a valid secret attributes the message; spectators have no input field
        if (typeof msg.secret !== "string" || typeof msg.text !== "string") return;
        const island = this.world.islandOf(msg.secret);
        if (!island) return;
        const text = msg.text.slice(0, 280);
        if (!text.trim()) return;
        this.broadcast({
          type: "chat",
          from: `${island.name} (${CIVS[island.civ].label})`,
          text,
          at: this.world.time,
        });
        break;
      }
    }
  }

  /** Called every sim tick: summaries + subscribed islands + events. */
  broadcastTick(events: GameEvent[]): void {
    const islands = this.world.islands();
    const summaries = islands.map((i) => summary(i, this.world));
    for (const client of this.clients) {
      this.send(client, {
        type: "world",
        time: this.world.time,
        daySeconds: this.balance.daySeconds,
        daylightShare: this.balance.daylightShare,
        catastrophe: this.world.catastrophe,
        islands: summaries,
      });
      for (const id of client.subscribed) {
        const island = this.world.island(id);
        if (island) this.send(client, { type: "island", island });
      }
      this.sendEvents(client, events);
    }
  }

  /** Immediate fan-out (pulse echoes must land well inside 10 s). */
  broadcastNow(events: GameEvent[]): void {
    for (const client of this.clients) this.sendEvents(client, events);
  }

  private sendEvents(client: ClientState, events: GameEvent[]): void {
    const visible = events.filter(
      (e) => e.world || (e.islandId && client.subscribed.has(e.islandId)),
    );
    if (visible.length) this.send(client, { type: "events", events: visible });
  }

  private broadcast(msg: unknown): void {
    for (const client of this.clients) this.send(client, msg);
  }

  private send(client: ClientState, msg: unknown): void {
    if (client.socket.readyState === SOCKET_OPEN) {
      client.socket.send(JSON.stringify(msg));
    }
  }
}
