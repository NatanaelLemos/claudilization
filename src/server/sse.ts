/**
 * The fallback transport: Server-Sent Events down, plain POSTs up.
 *
 * Some hosts proxy apps with a fetch-based reverse proxy that never performs
 * an HTTP upgrade — a WebSocket simply cannot reach us there, while streaming
 * responses pass through untouched. So a session gets one long-lived SSE
 * response for server→client frames and posts its own frames to a sibling
 * endpoint. Both ends speak the *same* protocol as the WebSocket path: this
 * file only provides a socket-shaped object, and `Hub` never learns which
 * transport a client arrived on.
 */
import { randomUUID } from "node:crypto";
import type { HubSocket } from "./ws";

const OPEN = 1;
const CLOSED = 3;

/** How often a comment line is written so proxies don't buffer or idle us out. */
export const SSE_HEARTBEAT_MS = 15_000;

/** A `Hub` client backed by an SSE response instead of a WebSocket. */
export class SseSocket implements HubSocket {
  readyState = OPEN;
  private messageListeners: ((raw: unknown) => void)[] = [];
  private closeListeners: (() => void)[] = [];

  constructor(private readonly write: (chunk: string) => void) {}

  send(data: string): void {
    if (this.readyState !== OPEN) return;
    // JSON.stringify never emits a raw newline, but a framing bug must not be
    // able to inject SSE control lines — split defensively.
    const body = String(data)
      .split("\n")
      .map((line) => `data: ${line}`)
      .join("\n");
    this.deliver(`${body}\n\n`);
  }

  /** Keep the stream (and every proxy in front of it) awake. */
  heartbeat(): void {
    if (this.readyState !== OPEN) return;
    this.deliver(`: ping ${Date.now()}\n\n`);
  }

  /** A frame the client POSTed, handed to `Hub` as if the socket received it. */
  receive(raw: unknown): void {
    if (this.readyState !== OPEN) return;
    for (const listener of [...this.messageListeners]) listener(raw);
  }

  on(event: "message", listener: (raw: unknown) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "message" | "close", listener: (raw?: unknown) => void): this {
    if (event === "message") this.messageListeners.push(listener);
    else this.closeListeners.push(listener as () => void);
    return this;
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    for (const listener of [...this.closeListeners]) listener();
    this.messageListeners = [];
    this.closeListeners = [];
  }

  private deliver(chunk: string): void {
    try {
      this.write(chunk);
    } catch {
      // the client hung up mid-write — treat it as a close
      this.close();
    }
  }
}

/**
 * Live SSE sessions, keyed by an opaque id the server mints. The id is the
 * first frame the client receives; it must present it to post anything back.
 */
export class SseSessions {
  private sessions = new Map<string, SseSocket>();

  open(write: (chunk: string) => void): { id: string; socket: SseSocket } {
    const id = randomUUID();
    const socket = new SseSocket(write);
    this.sessions.set(id, socket);
    socket.on("close", () => this.sessions.delete(id));
    return { id, socket };
  }

  get(id: string): SseSocket | undefined {
    return this.sessions.get(id);
  }

  /** Deliver a client frame to its session. False when the session is gone. */
  deliver(id: string, message: unknown): boolean {
    const socket = this.sessions.get(id);
    if (!socket || socket.readyState !== OPEN) return false;
    socket.receive(JSON.stringify(message));
    return true;
  }

  close(id: string): void {
    this.sessions.get(id)?.close();
    this.sessions.delete(id);
  }

  get size(): number {
    return this.sessions.size;
  }

  /** One heartbeat for every live stream. */
  heartbeatAll(): void {
    for (const socket of [...this.sessions.values()]) socket.heartbeat();
  }
}
