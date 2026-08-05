import { describe, expect, it } from "vitest";
import { SseSessions, SseSocket } from "./sse";
import { Hub } from "./ws";
import { World } from "./world";

/** Collect what an SSE response would have written, frame by frame. */
function recorder() {
  const chunks: string[] = [];
  const socket = new SseSocket((chunk) => chunks.push(chunk));
  const frames = () =>
    chunks
      .filter((c) => c.startsWith("data: "))
      .map((c) => JSON.parse(c.slice("data: ".length).trim()) as Record<string, unknown>);
  return { socket, chunks, frames };
}

describe("the SSE socket adapter", () => {
  it("writes each message as one SSE data frame", () => {
    const { socket, chunks, frames } = recorder();
    socket.send(JSON.stringify({ type: "world", islands: [] }));
    expect(chunks[0]).toBe('data: {"type":"world","islands":[]}\n\n');
    expect(frames()[0]).toEqual({ type: "world", islands: [] });
  });

  it("hands posted frames to the hub's message listener", () => {
    const { socket } = recorder();
    const seen: string[] = [];
    socket.on("message", (raw) => seen.push(String(raw)));
    socket.receive(JSON.stringify({ type: "hello", secret: "s-1" }));
    expect(seen).toEqual(['{"type":"hello","secret":"s-1"}']);
  });

  it("closes once: listeners fire, and nothing is written afterwards", () => {
    const { socket, chunks } = recorder();
    let closes = 0;
    socket.on("close", () => closes++);
    socket.close();
    socket.close();
    socket.send(JSON.stringify({ type: "world" }));
    socket.receive(JSON.stringify({ type: "chat" }));
    expect(closes).toBe(1);
    expect(socket.readyState).toBe(3);
    expect(chunks).toHaveLength(0);
  });

  it("heartbeats with a comment line so proxies don't buffer or idle out", () => {
    const { socket, chunks } = recorder();
    socket.heartbeat();
    expect(chunks[0]?.startsWith(": ping")).toBe(true);
    expect(chunks[0]?.endsWith("\n\n")).toBe(true);
  });

  it("treats a failed write as the client hanging up", () => {
    let closed = false;
    const socket = new SseSocket(() => {
      throw new Error("EPIPE");
    });
    socket.on("close", () => (closed = true));
    socket.send(JSON.stringify({ type: "world" }));
    expect(closed).toBe(true);
    expect(socket.readyState).toBe(3);
  });
});

describe("SSE sessions", () => {
  it("mints an opaque id per stream and routes frames to it", () => {
    const sessions = new SseSessions();
    const a: string[] = [];
    const b: string[] = [];
    const one = sessions.open((c) => a.push(c));
    const two = sessions.open((c) => b.push(c));
    expect(one.id).not.toBe(two.id);

    const received: string[] = [];
    one.socket.on("message", (raw) => received.push(String(raw)));
    expect(sessions.deliver(one.id, { type: "chat", text: "hi" })).toBe(true);
    expect(received).toEqual(['{"type":"chat","text":"hi"}']);
    expect(sessions.deliver("not-a-session", { type: "chat" })).toBe(false);
  });

  it("drops the session when the stream closes", () => {
    const sessions = new SseSessions();
    const { id, socket } = sessions.open(() => {});
    expect(sessions.size).toBe(1);
    socket.close();
    expect(sessions.size).toBe(0);
    expect(sessions.get(id)).toBeUndefined();
    expect(sessions.deliver(id, { type: "chat" })).toBe(false);
  });

  it("heartbeats every live stream", () => {
    const sessions = new SseSessions();
    const beats: string[] = [];
    sessions.open((c) => beats.push(c));
    sessions.open((c) => beats.push(c));
    sessions.heartbeatAll();
    expect(beats.filter((c) => c.startsWith(": ping"))).toHaveLength(2);
  });
});

describe("the hub speaks the same protocol over SSE as over WebSocket", () => {
  const openWorld = () => {
    const world = World.create({ seed: 7 });
    const joined = world.join({ civ: "roman" });
    const hub = new Hub(world, world.law, new Map<string, number>());
    return { world, hub, joined };
  };

  it("greets a stream with the whole ocean", () => {
    const { hub } = openWorld();
    const { socket, frames } = recorder();
    hub.attachSocket(socket);
    expect(frames()[0]?.type).toBe("world");
    expect((frames()[0]?.islands as unknown[]).length).toBeGreaterThan(0);
    expect(hub.clientCount).toBe(1);
  });

  it("answers hello with the island, and streams its detail on subscribe", () => {
    const { hub, joined } = openWorld();
    const { socket, frames } = recorder();
    hub.attachSocket(socket);
    socket.receive(JSON.stringify({ type: "hello", secret: joined.secret }));
    const hello = frames().find((f) => f.type === "hello");
    expect(hello?.islandId).toBe(joined.islandId);

    socket.receive(JSON.stringify({ type: "subscribe", islands: [joined.islandId] }));
    const island = frames().find((f) => f.type === "island");
    expect((island?.island as { id: string }).id).toBe(joined.islandId);
  });

  it("fans ticks and chat out to stream clients", () => {
    const { world, hub, joined } = openWorld();
    const { socket, frames } = recorder();
    hub.attachSocket(socket);
    socket.receive(JSON.stringify({ type: "hello", secret: joined.secret }));
    hub.broadcastTick(world.tick(1));
    expect(frames().filter((f) => f.type === "world").length).toBeGreaterThan(1);

    socket.receive(JSON.stringify({ type: "chat", secret: joined.secret, text: "ahoy" }));
    expect(frames().find((f) => f.type === "chat")?.text).toBe("ahoy");
  });

  it("forgets a client when its stream closes", () => {
    const { world, hub } = openWorld();
    const { socket, chunks } = recorder();
    hub.attachSocket(socket);
    socket.close();
    expect(hub.clientCount).toBe(0);
    const before = chunks.length;
    hub.broadcastTick(world.tick(1));
    expect(chunks).toHaveLength(before);
  });
});
