import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { createApi } from "./api";
import { FileStore, Persistence } from "./persistence";
import { Hub } from "./ws";
import { World } from "./world";

const BASE = "/apps/projects/claudilization";

let root: string;
let origin: string;
let close: () => Promise<void>;
let world: World;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "claudilization-api-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>island</title>");
  writeFileSync(join(dist, "assets", "app.js"), "export const hi = 1;\n");

  const persistence = await Persistence.open(new FileStore(join(root, "world")));
  world = World.create({ seed: 7 });
  await persistence.record({ type: "create", at: 0, seed: 7 });
  const lastSeen = new Map<string, number>();
  const hub = new Hub(world, world.law, lastSeen);
  const server = createApi(world, persistence, hub, world.law, lastSeen, dist, BASE);
  hub.attach(server, BASE);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
});

afterAll(async () => {
  await close();
  rmSync(root, { recursive: true, force: true });
});

/** Read SSE frames off a live stream until `want` matches, or give up. */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  want: (frame: Record<string, unknown>) => boolean,
  timeoutMs = 4000,
): Promise<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const blocks = buffered.split("\n\n");
      buffered = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!data) continue; // comment/heartbeat block
        const frame = JSON.parse(data) as Record<string, unknown>;
        if (want(frame)) return frame;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error("stream ended before the expected frame arrived");
}

describe("the API under a host prefix", () => {
  it("routes API calls that carry the prefix", async () => {
    const res = await fetch(`${origin}${BASE}/api/world`);
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { islands: unknown[] };
    expect(Array.isArray(body.islands)).toBe(true);
  });

  it("still routes API calls that arrive without it", async () => {
    const res = await fetch(`${origin}/api/world`);
    expect(res.status).toBe(200);
  });

  it("serves the client at the bare mount point and its assets under it", async () => {
    const page = await fetch(`${origin}${BASE}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>island</title>");

    const asset = await fetch(`${origin}${BASE}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe("application/javascript");
    expect(await asset.text()).toContain("export const hi");
  });

  it("falls back to the client for unknown paths under the prefix", async () => {
    const res = await fetch(`${origin}${BASE}/some/deep/link`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>island</title>");
  });

  it("hands out player links that keep the prefix and the forwarded host", async () => {
    const res = await fetch(`${origin}${BASE}/api/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-host": "clawdia.example.com",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ civ: "roman", name: "Test Isle" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { playerUrl: string; watchUrl: string; secret: string };
    expect(body.watchUrl).toBe(`https://clawdia.example.com${BASE}/`);
    expect(body.playerUrl).toBe(
      `https://clawdia.example.com${BASE}/?key=${body.secret}`,
    );
  });

  it("templates the install script with the prefixed public root", async () => {
    const res = await fetch(`${origin}${BASE}/install.sh`, {
      headers: { "x-forwarded-host": "clawdia.example.com", "x-forwarded-proto": "https" },
    });
    const script = await res.text();
    expect(script).toContain(`ORIGIN='https://clawdia.example.com${BASE}'`);
    expect(script).toContain("npm ci --omit=dev");
    expect(script).toContain("Archive checksum mismatch");
    expect(script).not.toContain("| tar");

    const archive = await fetch(`${origin}${BASE}/claudilization.tgz`);
    const digest = createHash("sha256")
      .update(Buffer.from(await archive.arrayBuffer()))
      .digest("hex");
    expect(script).toContain(digest);
  });

  it("rejects oversized and malformed request bodies without echoing them", async () => {
    const marker = "private-value-must-not-return";
    const oversized = await fetch(`${origin}${BASE}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ civ: "roman", padding: marker.repeat(5000) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).not.toContain(marker);

    const malformed = await fetch(`${origin}${BASE}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{\"secret\":\"${marker}\"`,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain(marker);
  });
});

describe("the SSE transport end to end", () => {
  it("streams the world, then carries hello both ways", async () => {
    const joined = world.join({ civ: "egyptian", name: "Streamers" });

    const stream = await fetch(`${origin}${BASE}/api/stream`, {
      headers: { accept: "text/event-stream" },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const body = stream.body!;
    const reader = body.getReader();
    const decoder = new TextDecoder();

    // first frame is the session id, second is the world
    let buffered = "";
    let session = "";
    while (!session) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream closed before the session id");
      buffered += decoder.decode(value, { stream: true });
      for (const block of buffered.split("\n\n")) {
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const frame = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (frame.type === "session") session = String(frame.session);
      }
    }
    expect(session).not.toBe("");
    expect(buffered).toContain('"type":"world"');
    reader.releaseLock();

    const posted = await fetch(`${origin}${BASE}/api/stream/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session,
        message: { type: "hello", secret: joined.secret },
      }),
    });
    expect(posted.status).toBe(200);

    const hello = await readFrames(body, (f) => f.type === "hello");
    expect(hello.islandId).toBe(joined.islandId);
    expect(hello.islandName).toBe("Streamers");
  });

  it("rejects frames for a session it never issued", async () => {
    const res = await fetch(`${origin}${BASE}/api/stream/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: "nope", message: { type: "hello", secret: "x" } }),
    });
    expect(res.status).toBe(404);
  });

  it("requires both a session and a message", async () => {
    const res = await fetch(`${origin}${BASE}/api/stream/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: "nope" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("the update channel", () => {
  it("tells a silent (pre-versioning) client about new powers, notice first", async () => {
    const joined = world.join({ civ: "roman", name: "Stale Isle" });
    const res = await fetch(`${origin}${BASE}/api/state?secret=${joined.secret}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    // the notice must LEAD the payload: pre-versioning clients dump this JSON
    // verbatim into the sync reply, and the top is what gets read
    expect(text.startsWith('{"updateAvailable"')).toBe(true);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(String(body.updateAvailable)).toContain("create");
    expect(String(body.updateHow)).toContain("/install.sh");
    expect(String(body.updateHow)).toContain("~/.claudilization/app");
    expect(String(body.updateHow).toLowerCase()).toContain("not re-join");
    expect(body.protocol).toBe(PROTOCOL_VERSION);
  });

  it("stays quiet for a client speaking the current protocol", async () => {
    const joined = world.join({ civ: "greek", name: "Fresh Isle" });
    const res = await fetch(
      `${origin}${BASE}/api/state?secret=${joined.secret}&client=${PROTOCOL_VERSION}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.updateAvailable).toBeUndefined();
    expect(body.updateHow).toBeUndefined();
    expect(body.protocol).toBe(PROTOCOL_VERSION);
  });

  it("answers the version probe without auth", async () => {
    const res = await fetch(`${origin}${BASE}/api/version`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "claudilization", protocol: PROTOCOL_VERSION });
  });
});

describe("orders judged one by one", () => {
  it("refuses an unknown kind with a reason while carrying out the rest", async () => {
    const joined = world.join({ civ: "norse", name: "Order Isle" });
    const res = await fetch(`${origin}${BASE}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: joined.secret,
        orders: [{ kind: "advance_age" }, { kind: "summon_kraken", size: 9 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcomes: { order: unknown; ok: boolean; reason?: string }[];
    };
    expect(body.outcomes).toHaveLength(2);
    // the known order reached the world (carried or lawfully refused there)
    expect(body.outcomes[0]!.order).toEqual({ kind: "advance_age" });
    // the alien order was refused at the gate, batch intact
    expect(body.outcomes[1]!.ok).toBe(false);
    expect(body.outcomes[1]!.reason).toContain("unknown order kind");
  });

  it("still hard-rejects a broken batch shape", async () => {
    const joined = world.join({ civ: "aztec", name: "Shape Isle" });
    const res = await fetch(`${origin}${BASE}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: joined.secret, orders: "orders" }),
    });
    expect(res.status).toBe(400);
  });
});
