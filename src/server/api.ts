import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { advanceRequirements, AGE_RESOURCES, ageIndex, nextAge } from "../shared/ages";
import type { Balance } from "../shared/balance";
import { BUILDINGS } from "../shared/buildings";
import { CREATION_LIMITS, CREATION_VERBS } from "../shared/creations";
import { dayPhase, dayWindows, isNight, secondsIntoDay } from "../shared/daylight";
import { computeHappiness } from "../shared/happiness";
import { parseOrders } from "../shared/orders";
import { WONDER_CIV, WONDERS } from "../shared/wonders";
import { CIV_IDS, type CivId, type DebugGrant, type Island } from "../shared/types";
import { verifyOwner } from "./auth";
import { basePathFromEnv, publicRoot, stripBasePath } from "./basePath";
import type { Persistence } from "./persistence";
import { computeRecap } from "./recap";
import { SSE_HEARTBEAT_MS, SseSessions } from "./sse";
import type { Hub } from "./ws";
import type { World } from "./world";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Raw text is kept alongside the parse — owner signatures cover it verbatim. */
async function readBody(
  req: IncomingMessage,
): Promise<{ raw: string; data: Record<string, unknown> }> {
  const declared = Number(firstHeader(req, "content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    throw new HttpError(413, "request body too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new HttpError(413, "request body too large");
    }
    chunks.push(part);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return { raw, data: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "JSON body must be an object");
  }
  return { raw, data: parsed as Record<string, unknown> };
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

/**
 * Paired islands answer only to requests signed by their owner's key; islands
 * that never completed the handshake keep the original secret-only rule.
 */
function ownerGate(
  req: IncomingMessage,
  island: Island,
  path: string,
  rawBody: string,
): { ok: true } | { ok: false; reason: string } {
  if (!island.ownerKey) return { ok: true };
  return verifyOwner({
    publicKeyPem: island.ownerKey,
    ts: firstHeader(req, "x-clz-ts"),
    sig: firstHeader(req, "x-clz-sig"),
    method: req.method ?? "POST",
    path,
    body: rawBody,
  });
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Compass bearing from one island to another — north is -y for everyone. */
function bearingOf(dx: number, dy: number): string {
  const POINTS = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
  ] as const;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return POINTS[Math.round(angle / 45) % 8]!;
}

/** The island as the player's own Claude sees it — state only, never prompt text. */
function brainState(world: World, secret: string, balance: Balance) {
  const island = world.islandOf(secret);
  if (!island) return null;
  const next = nextAge(island.age);
  const nearby = world
    .islands()
    .filter((other) => other.id !== island.id && other.ownerId !== island.id)
    .map((other) => ({
      id: other.id,
      name: other.name,
      civ: other.civ,
      age: other.age,
      kind: other.kind,
      ruins: other.ruins,
      // an empty island is free land; a rival colony can be taken by force
      colonizable: other.kind === "wild",
      attackable: other.kind === "colony" && other.ownerId !== island.id && !other.ruins,
      distance: Math.round(
        Math.hypot(
          other.position.x - island.position.x,
          other.position.y - island.position.y,
        ),
      ),
      bearing: bearingOf(
        other.position.x - island.position.x,
        other.position.y - island.position.y,
      ),
    }))
    .filter((other) => other.distance <= balance.nearbyRadius);
  const colonies = world
    .islands()
    .filter((other) => other.kind === "colony" && other.ownerId === island.id)
    .map((other) => ({
      id: other.id,
      name: other.name,
      age: other.age,
      population: other.settlers.length,
      stocks: other.stocks,
      buildings: other.buildings.map((b) => ({ type: b.type, stage: b.stage })),
      ruins: other.ruins,
      distance: Math.round(
        Math.hypot(
          other.position.x - island.position.x,
          other.position.y - island.position.y,
        ),
      ),
      bearing: bearingOf(
        other.position.x - island.position.x,
        other.position.y - island.position.y,
      ),
    }));
  return {
    island: {
      id: island.id,
      name: island.name,
      civ: island.civ,
      age: island.age,
      workPoints: Math.floor(island.workPoints),
      nextAge: next,
      nextAgeRequires: next ? advanceRequirements(next, balance) : null,
      stocks: island.stocks,
      settlers: island.settlers.map((s) => ({
        name: s.name,
        adult: s.adult,
        task: s.task,
        hungerDays: s.hungerDays,
      })),
      buildings: island.buildings.map((b) => ({
        type: b.type,
        stage: b.stage,
      })),
      boats: island.boats.map((b) => ({ state: b.state, intent: b.intent })),
      dormant: island.dormant,
      natureNodes: island.nodes.reduce<Record<string, number>>((acc, n) => {
        if (n.remaining > 0) acc[n.resource] = (acc[n.resource] ?? 0) + 1;
        return acc;
      }, {}),
      // where the food actually comes from: herds, fishing grounds, orchards, patches
      foodSources: island.nodes.reduce<Record<string, number>>((acc, n) => {
        if (n.remaining > 0 && n.source) acc[n.source] = (acc[n.source] ?? 0) + 1;
        return acc;
      }, {}),
      resourcesUnlocked: AGE_RESOURCES[island.age],
      happiness: (() => {
        const mood = computeHappiness(island, balance);
        return {
          score: mood.score,
          needs: mood.needs.map((n) => ({ need: n.label, met: n.met })),
          leisureJoy: mood.leisure,
          wonderJoy: mood.wonders,
        };
      })(),
      buildable: [
        ...BUILDINGS.filter((b) => ageIndex(b.age) <= ageIndex(island.age)),
        // only this people's wonders — one monument per age, never a rival's
        ...WONDERS.filter(
          (b) =>
            WONDER_CIV.get(b.type) === island.civ &&
            ageIndex(b.age) <= ageIndex(island.age) &&
            !island.buildings.some((x) => x.type === b.type),
        ),
      ].map((b) => ({
        type: b.type,
        age: b.age,
        cost: b.cost,
        houses: b.houses,
        foodPerDay: b.foodPerDay,
        joy: b.joy,
        wonder: b.wonder,
      })),
      // the player's invented creations: designs, where their units stand,
      // and the hard limits the design gate enforces
      creations: {
        designs: (island.creationSpecs ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          stats: s.stats,
          verbs: s.verbs,
          gathers: s.gathers,
          unitsHome: (island.creations ?? []).filter((u) => u.specId === s.id).length,
          unitsAtSea: (island.creationBands ?? [])
            .filter((b) => b.specId === s.id)
            .reduce((n, b) => n + b.units.length, 0),
          unitsGarrisoned: world
            .islands()
            .filter((o) => o.id !== island.id && o.ownerId === island.id)
            .reduce(
              (n, o) =>
                n + (o.creations ?? []).filter((u) => u.specId === s.id).length,
              0,
            ),
        })),
        bands: (island.creationBands ?? []).map((b) => ({
          dest: b.dest,
          intent: b.intent,
          state: b.state,
          units: b.units.length,
        })),
        limits: {
          verbs: CREATION_VERBS,
          maxDesigns: CREATION_LIMITS.maxSpecsPerIsland,
          maxUnits: CREATION_LIMITS.maxUnitsPerIsland,
          maxCountPerOrder: CREATION_LIMITS.maxCountPerOrder,
          maxCreatesPerDay: CREATION_LIMITS.maxCreatesPerDay,
          statMax: CREATION_LIMITS.statMax,
          statBudget: CREATION_LIMITS.statBudget,
          costPerUnit: "food 4x(power+speed+resilience), wood 2x(power+speed+resilience)",
        },
      },
    },
    colonies,
    nearbyIslands: nearby,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** One-shot local setup, served templated with this world's own address. */
function installScript(origin: string, digest: string): string {
  return `#!/bin/sh
set -eu
umask 077
APP="$HOME/.claudilization/app"
ORIGIN=${shellQuote(origin)}
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
echo "Installing Claudilization to $APP…"
mkdir -p "$APP"
curl -fsS "$ORIGIN/claudilization.tgz" -o "$TMP/claudilization.tgz"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP/claudilization.tgz" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "$TMP/claudilization.tgz" | awk '{print $1}')"
fi
[ "$ACTUAL" = "${digest}" ] || { echo "Archive checksum mismatch" >&2; exit 1; }
tar -xzf "$TMP/claudilization.tgz" -C "$APP"
cd "$APP"
npm ci --omit=dev --no-fund --no-audit --loglevel=error
claude mcp add --scope user claudilization -- npx tsx "$APP/src/mcp/server.ts" 2>/dev/null \\
  || echo "claudilization MCP already registered"
npx tsx "$APP/src/mcp/install.ts" --write
echo "Claudilization is installed. Every prompt now feeds your island."
`;
}

/** The playable client, packed once per boot from this server's own source. */
let archive: { path: string; digest: string } | null | undefined;
function ensureArchive(): { path: string; digest: string } | null {
  if (archive !== undefined) return archive;
  const repo = resolve(import.meta.dirname, "../..");
  const out = join(mkdtempSync(join(tmpdir(), "claudilization-")), "claudilization.tgz");
  const result = spawnSync(
    "tar",
    ["-czf", out, "src", "package.json", "package-lock.json", "tsconfig.json"],
    { cwd: repo },
  );
  archive = result.status === 0 && existsSync(out)
    ? {
        path: out,
        digest: createHash("sha256").update(readFileSync(out)).digest("hex"),
      }
    : null;
  return archive;
}

export function createApi(
  world: World,
  persistence: Persistence,
  hub: Hub,
  balance: Balance,
  lastSeen: Map<string, number>,
  distDir = "dist",
  basePath = basePathFromEnv(),
): Server {
  // staged doctrine edits for the visual editor — transient by design: never
  // part of the world state, never in the command log, gone on restart
  const doctrineDrafts = new Map<string, { doctrine: string }>();
  // live SSE clients (the transport for hosts whose proxy can't upgrade)
  const sessions = new SseSessions();
  const heartbeat = setInterval(() => sessions.heartbeatAll(), SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  const server = createHttpServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("cross-origin-resource-policy", "same-origin");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; base-uri 'none'; object-src 'none'; " +
        "script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self' data:; " +
        "connect-src 'self' ws: wss:; frame-ancestors 'self' https:",
    );
    try {
      const requested = new URL(req.url ?? "/", "http://localhost");
      // one translation, at the door: everything below routes on app-absolute
      // paths whether or not we're mounted under a prefix
      const { path: routedPath } = stripBasePath(requested.pathname, basePath);
      const url = new URL(requested.toString());
      url.pathname = routedPath;
      /** origin+prefix as the outside world sees us (proxy headers included) */
      const origin = () =>
        publicRoot(
          req.headers,
          req.headers.host ?? "localhost",
          basePath,
          process.env.CLAUDILIZATION_PUBLIC_URL,
        );

      if (req.method === "POST" && url.pathname === "/api/join") {
        const { data: b } = await readBody(req);
        const civ = String(b.civ ?? "");
        if (!(CIV_IDS as readonly string[]).includes(civ)) {
          return sendJson(res, 400, {
            error: `pick a civilization: ${CIV_IDS.join(", ")}`,
          });
        }
        const secret = typeof b.secret === "string" ? b.secret : undefined;
        const publicKey = typeof b.publicKey === "string" ? b.publicKey : undefined;
        const name = typeof b.name === "string" ? b.name : undefined;
        const result = world.join({ civ: civ as CivId, secret, publicKey, name });
        await persistence.record({
          type: "join",
          at: world.time,
          civ,
          secret: result.secret,
          publicKey,
          name,
        });
        const root = origin();
        return sendJson(res, 200, {
          ...result,
          watchUrl: `${root}/`,
          playerUrl: `${root}/?key=${result.secret}`,
        });
      }

      if (req.method === "POST" && url.pathname === "/api/pulse") {
        const { raw, data: b } = await readBody(req);
        const secret = String(b.secret ?? "");
        const island = world.islandOf(secret);
        if (!island) return sendJson(res, 404, { error: "unknown player" });
        const gate = ownerGate(req, island, url.pathname, raw);
        if (!gate.ok) return sendJson(res, 401, { error: gate.reason });
        const tokens = Math.max(0, Number(b.tokens ?? 0) || 0);
        const events = world.pulse(secret, tokens);
        await persistence.record({ type: "pulse", at: world.time, secret, tokens });
        hub.broadcastNow(events);
        return sendJson(res, 200, { events: events.length });
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        const secret = url.searchParams.get("secret") ?? "";
        const state = brainState(world, secret, balance);
        if (!state) return sendJson(res, 404, { error: "unknown player" });
        const island = world.islandOf(secret)!;
        const seen = lastSeen.get(secret) ?? world.time;
        const recap = computeRecap(world.feed(island.id), seen, world.time, balance);
        lastSeen.set(secret, world.time);
        return sendJson(res, 200, { ...state, recapLine: recap?.line ?? null });
      }

      if (req.method === "GET" && url.pathname === "/api/world") {
        const windows = dayWindows(balance.daySeconds, balance.daylightShare);
        return sendJson(res, 200, {
          time: world.time,
          // the one sun, stated plainly: anyone can check the sky against the
          // wall clock without opening a browser or reading a shader
          clock: {
            daySeconds: balance.daySeconds,
            daylightSeconds: windows.daylightSeconds,
            nightSeconds: windows.nightSeconds,
            dayClock: secondsIntoDay(world.time, balance.daySeconds),
            phase: dayPhase(world.time, balance.daySeconds),
            night: isNight(world.time, balance.daySeconds, balance.daylightShare),
            anchorMs: world.anchor,
            nowMs: Date.now(),
          },
          islands: world.islands().map((i) => ({
            id: i.id,
            name: i.name,
            civ: i.civ,
            age: i.age,
            kind: i.kind,
            ownerId: i.ownerId,
            position: i.position,
            ruins: i.ruins,
            dormant: i.dormant,
            population: i.settlers.length,
            stocks: i.stocks,
            boats: i.boats.map((b) => ({ state: b.state, intent: b.intent })),
          })),
        });
      }

      // test seam (council carry-forward 6): only mounted when CLAUDILIZATION_TEST=1
      if (
        req.method === "POST" &&
        url.pathname === "/api/debug/grant" &&
        process.env.CLAUDILIZATION_TEST === "1"
      ) {
        const { data: b } = await readBody(req);
        const islandId = String(b.islandId ?? "");
        const grant = (b.grant ?? {}) as DebugGrant;
        world.debugGrant(islandId, grant);
        await persistence.record({ type: "grant", at: world.time, islandId, grant });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "POST" && url.pathname === "/api/orders") {
        const { raw, data: b } = await readBody(req);
        const secret = String(b.secret ?? "");
        let orders;
        try {
          orders = parseOrders(b.orders);
        } catch (err) {
          return sendJson(res, 400, { error: `orders rejected: ${String(err)}` });
        }
        const island = world.islandOf(secret);
        if (!island) return sendJson(res, 404, { error: "unknown player" });
        const gate = ownerGate(req, island, url.pathname, raw);
        if (!gate.ok) return sendJson(res, 401, { error: gate.reason });
        const outcomes = world.applyOrders(secret, orders);
        await persistence.record({ type: "orders", at: world.time, secret, orders });
        return sendJson(res, 200, { outcomes });
      }

      // stage the player's local doctrine so the browser editor can prefill;
      // owner-signed like rename — only the paired machine may stage an edit
      if (req.method === "POST" && url.pathname === "/api/update-draft") {
        const { raw, data: b } = await readBody(req);
        const secret = String(b.secret ?? "");
        const island = world.islandOf(secret);
        if (!island) return sendJson(res, 404, { error: "unknown player" });
        const gate = ownerGate(req, island, url.pathname, raw);
        if (!gate.ok) return sendJson(res, 401, { error: gate.reason });
        doctrineDrafts.set(secret, { doctrine: String(b.doctrine ?? "") });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/api/update-draft") {
        const secret = url.searchParams.get("secret") ?? "";
        const island = world.islandOf(secret);
        if (!island) return sendJson(res, 404, { error: "unknown player" });
        return sendJson(res, 200, {
          name: island.name,
          civ: island.civ,
          doctrine: doctrineDrafts.get(secret)?.doctrine ?? null,
        });
      }

      if (req.method === "POST" && url.pathname === "/api/rename") {
        const { raw, data: b } = await readBody(req);
        const secret = String(b.secret ?? "");
        const name = String(b.name ?? "");
        const island = world.islandOf(secret);
        if (!island) return sendJson(res, 404, { error: "unknown player" });
        const gate = ownerGate(req, island, url.pathname, raw);
        if (!gate.ok) return sendJson(res, 401, { error: gate.reason });
        let events;
        try {
          events = world.rename(secret, name);
        } catch (err) {
          return sendJson(res, 400, { error: (err as Error).message });
        }
        await persistence.record({ type: "rename", at: world.time, secret, name });
        hub.broadcastNow(events);
        return sendJson(res, 200, { ok: true, name: island.name });
      }

      // the handshake: bind this island to its Claude's public key (first key wins)
      if (req.method === "POST" && url.pathname === "/api/pair") {
        const { data: b } = await readBody(req);
        const secret = String(b.secret ?? "");
        const publicKey = String(b.publicKey ?? "");
        if (!world.islandOf(secret)) return sendJson(res, 404, { error: "unknown player" });
        try {
          world.pair(secret, publicKey);
        } catch (err) {
          return sendJson(res, 409, { error: (err as Error).message });
        }
        await persistence.record({ type: "pair", at: world.time, secret, publicKey });
        return sendJson(res, 200, { ok: true });
      }

      // the fallback transport: one SSE stream down, POSTed frames up. Hosts
      // that proxy us with a fetch-based reverse proxy never perform an HTTP
      // upgrade, so a WebSocket can't reach us there — a stream still does.
      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          // tell any nginx-shaped middlebox not to buffer this response
          "x-accel-buffering": "no",
        });
        res.write(": claudilization stream\n");
        res.write("retry: 3000\n\n");
        const { id, socket } = sessions.open((chunk) => res.write(chunk));
        // the session id is the client's return address; it comes first so no
        // frame can be posted before the server knows who is posting it
        socket.send(JSON.stringify({ type: "session", session: id }));
        hub.attachSocket(socket);
        const drop = () => {
          sessions.close(id);
          res.end();
        };
        req.on("close", drop);
        req.on("error", drop);
        res.on("error", drop);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/stream/send") {
        const { data: b } = await readBody(req);
        const session = String(b.session ?? "");
        const message = b.message;
        if (!session || typeof message !== "object" || message === null) {
          return sendJson(res, 400, { error: "session and message are required" });
        }
        if (!sessions.deliver(session, message)) {
          return sendJson(res, 404, { error: "unknown session" });
        }
        return sendJson(res, 200, { ok: true });
      }

      // one-prompt onboarding: the installer script and the client archive
      if (req.method === "GET" && url.pathname === "/install.sh") {
        const bundle = ensureArchive();
        if (!bundle) return sendJson(res, 500, { error: "archive unavailable" });
        res.writeHead(200, {
          "content-type": "text/x-sh",
          "cache-control": "no-store",
        });
        res.end(installScript(origin(), bundle.digest));
        return;
      }
      if (req.method === "GET" && url.pathname === "/claudilization.tgz") {
        const bundle = ensureArchive();
        if (!bundle) return sendJson(res, 500, { error: "archive unavailable" });
        res.writeHead(200, {
          "content-type": "application/gzip",
          "content-disposition": 'attachment; filename="claudilization.tgz"',
        });
        res.end(readFileSync(bundle.path));
        return;
      }

      // static client
      if (req.method === "GET") {
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const distRoot = resolve(distDir);
        const file = resolve(distRoot, `.${path}`);
        const insideDist = file === distRoot || file.startsWith(`${distRoot}${sep}`);
        try {
          if (insideDist && statSync(file).isFile()) {
            res.writeHead(200, {
              "content-type": MIME[extname(file)] ?? "application/octet-stream",
              "cache-control": path.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "no-store",
            });
            return res.end(readFileSync(file));
          }
        } catch {
          // fall through
        }
        // SPA fallback
        try {
          const index = readFileSync(resolve(distRoot, "index.html"));
          res.writeHead(200, {
            "content-type": "text/html",
            "cache-control": "no-store",
          });
          return res.end(index);
        } catch {
          return sendJson(res, 503, { error: "client not built — run: npm run build" });
        }
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message });
      }
      console.error(`request failed: ${err instanceof Error ? err.name : "unknown error"}`);
      sendJson(res, 500, { error: "internal server error" });
    }
  });

  server.on("close", () => clearInterval(heartbeat));
  return server;
}
