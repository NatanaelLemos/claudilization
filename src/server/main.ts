import type { Balance } from "../shared/balance";
import { DEFAULT_BALANCE } from "../shared/balance";
import { dayAnchorMs, worldSecondsAt } from "../shared/daylight";
import { createApi } from "./api";
import { basePathFromEnv } from "./basePath";
import { FileStore, Persistence, PgStore, type CommandStore } from "./persistence";
import { Hub } from "./ws";
import { World } from "./world";

const PORT = Number(process.env.PORT ?? 8787);
/**
 * Hosts that proxy us hand down a loopback bind (Clawdia sets `HOSTNAME`);
 * standalone listens wide. Containers set `HOSTNAME` to the container id,
 * which is not an address — `CLAUDILIZATION_HOST` wins so a Docker/Fly deploy
 * can say what it means without fighting the runtime.
 */
const HOST = process.env.CLAUDILIZATION_HOST?.trim() || process.env.HOSTNAME?.trim() || "0.0.0.0";
/** "" standalone; "/apps/projects/claudilization" when a host mounts us. */
const BASE_PATH = basePathFromEnv();
const SEED = Number(process.env.CLAUDILIZATION_SEED ?? 42);
const DATA_DIR = process.env.CLAUDILIZATION_DATA ?? "data/world";
/** Postgres takes over when a connection string is provided. */
const DB = process.env.CLAUDILIZATION_DB ?? process.env.DATABASE_URL;
/** Test-only accelerated clock: JSON balance overrides (scenario tests). */
const OVERRIDES: Partial<Balance> = process.env.CLAUDILIZATION_BALANCE
  ? (JSON.parse(process.env.CLAUDILIZATION_BALANCE) as Partial<Balance>)
  : {};

async function openStore(): Promise<CommandStore> {
  if (!DB) return new FileStore(DATA_DIR);
  const store = new PgStore(DB);
  await store.init();
  // one-time takeover: an empty Postgres log inherits the old file world,
  // so switching storage never loses anyone's civilization
  if ((await store.readLog()).length === 0) {
    const fileLines = await new FileStore(DATA_DIR).readLog();
    for (const line of fileLines) await store.append(line);
    if (fileLines.length) {
      console.log(`Migrated ${fileLines.length} commands from ${DATA_DIR} into Postgres`);
    }
  }
  return store;
}

async function main(): Promise<void> {
  const persistence = await Persistence.open(await openStore());
  let world = await persistence.restore();
  if (!world) {
    // A new world is born on the wall clock: its zero is the top of the current
    // island day, so dawn falls on a round real hour from here to forever, and
    // it opens at the true time of day rather than at an arbitrary dawn.
    const daySeconds = { ...DEFAULT_BALANCE, ...OVERRIDES }.daySeconds;
    const anchorMs = dayAnchorMs(Date.now(), daySeconds);
    const at = worldSecondsAt(Date.now(), anchorMs);
    world = World.create({ seed: SEED, balance: OVERRIDES, anchorMs, at });
    await persistence.record({
      type: "create",
      at,
      seed: SEED,
      balance: OVERRIDES,
      anchorMs,
    });
  }
  // a world restored from a save older than the wall clock keeps the time it
  // had and is drift-free from this second on
  if (world.anchor === undefined) world.anchorTo(Date.now() - world.time * 1000);
  // whatever the restart cost, the world wakes at the true hour
  world.advanceToWallClock(Date.now());

  // the world's own law, not a re-merge of env — a restored world keeps the
  // balance it was created under, and every layer above must agree with it
  const balance: Balance = world.law;
  const lastSeen = new Map<string, number>();
  const hub = new Hub(world, balance, lastSeen);
  const server = createApi(world, persistence, hub, balance, lastSeen, "dist", BASE_PATH);
  hub.attach(server, BASE_PATH);

  setInterval(() => {
    // read the clock, never count it: a late timer catches up the second it
    // missed instead of quietly making the island's day longer than an hour
    const events = world.advanceToWallClock(Date.now());
    hub.broadcastTick(events);
    persistence.maybeSnapshot(world).catch((err) => {
      console.error("snapshot failed:", err);
    });
  }, 1000 * balance.tickSeconds);

  server.listen(PORT, HOST, () => {
    console.log(
      `Claudilization world listening on http://${HOST}:${PORT}${BASE_PATH || ""}/`,
    );
    console.log(
      `   islands: ${world.islands().length} · storage: ${DB ? "postgres" : DATA_DIR}` +
        `${BASE_PATH ? ` · mounted at ${BASE_PATH}` : ""}`,
    );
  });
}

void main();
