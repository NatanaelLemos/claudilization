import { DEFAULT_BALANCE } from "../shared/balance";
import type { Boat, Building, GameEvent, Island } from "../shared/types";
import type { Recap } from "../server/recap";
import { apiUrl, isMounted, socketUrl } from "./base";
import type {
  CreationBandView,
  CreationSpecView,
  CreationUnitView,
} from "./creationsView";

export interface IslandSummary {
  id: string;
  name: string;
  civ: Island["civ"];
  age: Island["age"];
  kind: Island["kind"];
  /** immutable provenance — home islands are sacred, neutral land is contested */
  origin?: Island["origin"];
  ownerId?: string;
  seed: number;
  /** tiles per side — older servers may not send it */
  size?: number;
  position: { x: number; y: number };
  ruins: boolean;
  dormant: boolean;
  lastPulseAt: number;
  lastPulseSeq: number;
  population: number;
  /** the whole built world rides the summary so no island ever renders bare */
  buildings?: Building[];
  boats?: Pick<Boat, "id" | "pos" | "state" | "craft">[];
  /** player-invented creations: designs (pixel-art), units ashore, bands at sea */
  creationSpecs?: CreationSpecView[];
  creations?: CreationUnitView[];
  creationBands?: CreationBandView[];
  time: number;
}

export interface HelloReply {
  islandId: string;
  islandName: string;
  recap: Recap | null;
}

type Frame = Record<string, unknown>;

interface TransportHooks {
  /** ready to carry client frames — hello and subscribe go out here */
  onOpen: () => void;
  onFrame: (msg: Frame) => void;
  /** `everOpened` is false when the transport never worked at all */
  onClose: (everOpened: boolean) => void;
}

interface Transport {
  send(msg: unknown): void;
  close(): void;
}

function parseFrame(data: unknown): Frame | null {
  try {
    const msg = JSON.parse(String(data)) as unknown;
    return msg && typeof msg === "object" ? (msg as Frame) : null;
  } catch {
    return null;
  }
}

/**
 * The world's clock out of a world frame. Newer servers put it on the frame
 * itself; older ones only stamp each summary, so fall back to that rather than
 * leaving a viewer with no sun at all.
 */
export function worldTimeOf(frame: Frame, islands: IslandSummary[]): number | undefined {
  if (typeof frame.time === "number" && Number.isFinite(frame.time)) return frame.time;
  for (const island of islands) {
    if (typeof island?.time === "number" && Number.isFinite(island.time)) return island.time;
  }
  return undefined;
}

/** How long a WebSocket gets to open before we give up and fall back. */
const WS_OPEN_TIMEOUT_MS = 4000;

/** The native transport — used whenever the host actually proxies upgrades. */
class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private opened = false;
  private finished = false;

  constructor(
    url: string,
    private hooks: TransportHooks,
  ) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.opened = true;
      this.hooks.onOpen();
    };
    this.ws.onmessage = (ev) => {
      const msg = parseFrame(ev.data);
      if (msg) this.hooks.onFrame(msg);
    };
    this.ws.onclose = () => this.finish();
    this.ws.onerror = () => {
      /* a close event always follows */
    };
    setTimeout(() => {
      if (this.opened || this.finished) return;
      try {
        this.ws.close();
      } catch {
        /* already gone */
      }
      this.finish();
    }, WS_OPEN_TIMEOUT_MS);
  }

  send(msg: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.finished = true;
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.hooks.onClose(this.opened);
  }
}

/**
 * The fallback: an SSE stream down, POSTs up. Hosts that reverse-proxy this app
 * with `fetch` never perform an HTTP upgrade — a WebSocket cannot reach the
 * server there, but a streamed response passes through fine. The protocol on
 * the wire is identical; only the pipe changes.
 */
class SseTransport implements Transport {
  private stream: EventSource;
  private session?: string;
  private pending: unknown[] = [];
  private finished = false;

  constructor(private hooks: TransportHooks) {
    this.stream = new EventSource(apiUrl("/api/stream"));
    this.stream.onmessage = (ev) => {
      const msg = parseFrame(ev.data);
      if (!msg) return;
      // the server's first frame is this stream's return address
      if (msg.type === "session" && typeof msg.session === "string") {
        this.session = msg.session;
        this.hooks.onOpen();
        const queued = this.pending;
        this.pending = [];
        for (const m of queued) this.send(m);
        return;
      }
      this.hooks.onFrame(msg);
    };
    this.stream.onerror = () => this.finish();
  }

  send(msg: unknown): void {
    if (this.finished) return;
    if (!this.session) {
      this.pending.push(msg);
      return;
    }
    void fetch(apiUrl("/api/stream/send"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: this.session, message: msg }),
    })
      .then((res) => {
        // the server forgot us (restart, dropped stream) — reconnect whole
        if (res.status === 404) this.finish();
      })
      .catch(() => this.finish());
  }

  close(): void {
    this.finished = true;
    this.stream.close();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stream.close();
    this.hooks.onClose(Boolean(this.session));
  }
}

/**
 * Live link to the world: world summaries, subscribed island detail, events,
 * chat. Native WebSocket when the host allows it, SSE+POST when it doesn't —
 * callers never see the difference.
 */
export class Net {
  private transport?: Transport;
  private key?: string;
  private subscribedIds: string[] = [];
  /** mounted under a host prefix ⇒ assume no upgrades; proven failure sets it too */
  private forceFallback = isMounted();
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  /** the server's actual day length — worlds born on a fast clock stay fast */
  daySeconds?: number;
  /** the world's own share of daylight: the sky must arc on the server's law,
   * not on a constant compiled into the client, or the sun and the settlers'
   * bedtime drift apart */
  daylightShare?: number;
  /** the world's own clock, as of the last world frame — the one and only
   * source of the time of day; island detail never carries the sun */
  worldTime?: number;

  onWorld?: (islands: IslandSummary[]) => void;
  /** Fired only by world frames — the sky's single source. Island detail must
   * never move the sun, or peeking at a neighbour would change the hour. */
  onWorldClock?: (worldSeconds: number, daySeconds: number, daylightShare: number) => void;
  onIsland?: (island: Island) => void;
  onEvents?: (events: GameEvent[]) => void;
  onChat?: (from: string, text: string) => void;
  onHello?: (reply: HelloReply) => void;

  connect(key?: string): void {
    this.key = key;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.transport?.close();

    const hooks: TransportHooks = {
      onOpen: () => this.greet(),
      onFrame: (msg) => this.handle(msg),
      onClose: (everOpened) => {
        // a WebSocket that never opened means this host can't upgrade: switch
        // to the stream transport at once instead of waiting out a retry
        if (!everOpened && !this.forceFallback) {
          this.forceFallback = true;
          this.connect(this.key);
          return;
        }
        this.reconnect();
      },
    };

    this.transport = this.forceFallback
      ? new SseTransport(hooks)
      : new WebSocketTransport(socketUrl(), hooks);
  }

  subscribe(ids: string[]): void {
    this.subscribedIds = ids;
    this.send({ type: "subscribe", islands: ids });
  }

  chat(text: string): void {
    if (this.key) this.send({ type: "chat", secret: this.key, text });
  }

  private greet(): void {
    if (this.key) this.send({ type: "hello", secret: this.key });
    if (this.subscribedIds.length)
      this.send({ type: "subscribe", islands: this.subscribedIds });
  }

  private handle(msg: Frame): void {
    switch (msg.type) {
      case "world": {
        if (typeof msg.daySeconds === "number") this.daySeconds = msg.daySeconds;
        if (typeof msg.daylightShare === "number") this.daylightShare = msg.daylightShare;
        const islands = (msg.islands ?? []) as IslandSummary[];
        const time = worldTimeOf(msg, islands);
        if (time !== undefined) {
          this.worldTime = time;
          this.onWorldClock?.(
            time,
            this.daySeconds ?? DEFAULT_BALANCE.daySeconds,
            this.daylightShare ?? DEFAULT_BALANCE.daylightShare,
          );
        }
        this.onWorld?.(islands);
        break;
      }
      case "island":
        this.onIsland?.(msg.island as Island);
        break;
      case "events":
        this.onEvents?.(msg.events as GameEvent[]);
        break;
      case "chat":
        this.onChat?.(String(msg.from), String(msg.text));
        break;
      case "hello":
        this.onHello?.(msg as unknown as HelloReply);
        break;
    }
  }

  private reconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(this.key);
    }, 3000);
  }

  private send(msg: unknown): void {
    this.transport?.send(msg);
  }
}
