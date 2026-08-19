/**
 * Operator repair: prune duplicate buildings out of the persisted world.
 *
 * A bug (or an order-spamming client) can stack thousands of the same building
 * on one island. The world lives in memory on the running machine and re-saves
 * `world_snapshot` on a cadence, so a live edit gets clobbered: STOP THE
 * MACHINE FIRST, prune, then start it.
 *
 * This edits `world_snapshot.state` only — the append-only `world_log` is never
 * touched, so the boot-time replay of the log tail still applies. Everything
 * except the removed building entries stays byte-identical: the script refuses
 * to run unless JSON.stringify(JSON.parse(state)) round-trips exactly, and it
 * refuses to remove a building whose id is referenced anywhere else in the
 * world (a settler's task, a house assignment, a creation post).
 *
 *   DATABASE_URL=... node scripts/prune-buildings.mjs \
 *     --island island-130 --type elder-lodge --remove 151 [--keep 151] \
 *     [--order newest|oldest] [--dry]
 *
 * --order newest (default) drops the highest building-id ordinals, so the
 * original placement keeps its spot and the bug's spam is what goes.
 */
import pg from "pg";

function parseArgs(argv) {
  const args = { order: "newest", dry: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry") args.dry = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for --${key}`);
      args[key] = value;
    } else throw new Error(`unexpected argument: ${arg}`);
  }
  if (!args.island) throw new Error("--island is required (e.g. --island island-130)");
  if (!args.type) throw new Error("--type is required (e.g. --type elder-lodge)");
  if (args.remove === undefined && args.keep === undefined) {
    throw new Error("one of --remove <n> or --keep <n> is required");
  }
  if (args.order !== "newest" && args.order !== "oldest") {
    throw new Error("--order must be newest or oldest");
  }
  return args;
}

/** Building ids are `<island>-b<ordinal>`; the ordinal is placement order. */
function ordinal(id) {
  const match = /-b(\d+)$/.exec(String(id));
  return match ? Number(match[1]) : Number.NaN;
}

function census(buildings) {
  const counts = {};
  for (const b of buildings) counts[b.type] = (counts[b.type] ?? 0) + 1;
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL ?? process.env.CLAUDILIZATION_DB;
  if (!connectionString) throw new Error("set DATABASE_URL (or CLAUDILIZATION_DB)");

  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snap = await client.query(
      "SELECT at, line_count, state FROM world_snapshot WHERE id = 1 FOR UPDATE",
    );
    const row = snap.rows[0];
    if (!row) throw new Error("no world_snapshot row — nothing to prune");

    const state = row.state;
    const world = JSON.parse(state);
    if (JSON.stringify(world) !== state) {
      throw new Error(
        "snapshot does not round-trip byte-for-byte through JSON — refusing to rewrite it",
      );
    }

    const island = world.islands.find((i) => i.id === args.island);
    if (!island) throw new Error(`no island ${args.island} in the snapshot`);

    const before = census(island.buildings);
    const present = island.buildings.filter((b) => b.type === args.type);
    if (present.length === 0) throw new Error(`island ${args.island} has no ${args.type}`);
    if (present.some((b) => Number.isNaN(ordinal(b.id)))) {
      throw new Error("some building ids carry no ordinal — refusing to guess an order");
    }

    const removeCount =
      args.remove !== undefined ? Number(args.remove) : present.length - Number(args.keep);
    if (!Number.isInteger(removeCount) || removeCount <= 0) {
      throw new Error(`nothing to remove (computed ${removeCount})`);
    }
    if (removeCount > present.length) {
      throw new Error(`asked to remove ${removeCount} but only ${present.length} exist`);
    }
    if (args.keep !== undefined && args.remove !== undefined) {
      const keep = Number(args.keep);
      if (present.length - removeCount !== keep) {
        throw new Error(
          `--remove ${removeCount} would leave ${present.length - removeCount}, not --keep ${keep}`,
        );
      }
    }

    const ranked = [...present].sort((a, b) =>
      args.order === "newest" ? ordinal(b.id) - ordinal(a.id) : ordinal(a.id) - ordinal(b.id),
    );
    const doomed = ranked.slice(0, removeCount);
    const doomedIds = new Set(doomed.map((b) => b.id));

    // A building id may be referenced by a settler task, a house assignment or a
    // creation post. Removing one of those would leave a dangling pointer.
    const withoutBuildings = JSON.stringify({ ...world, islands: world.islands.map((i) =>
      i.id === island.id ? { ...i, buildings: [] } : i) });
    const referenced = [...doomedIds].filter((id) => withoutBuildings.includes(`"${id}"`));
    if (referenced.length) {
      throw new Error(
        `${referenced.length} condemned building(s) are referenced elsewhere in the world ` +
          `(e.g. ${referenced[0]}) — refusing to strand those references`,
      );
    }

    island.buildings = island.buildings.filter((b) => !doomedIds.has(b.id));
    const after = census(island.buildings);
    const nextState = JSON.stringify(world);

    const drift = Object.keys({ ...before, ...after }).filter(
      (type) => type !== args.type && before[type] !== after[type],
    );
    if (drift.length) throw new Error(`other building types changed: ${drift.join(", ")}`);

    const report = {
      island: island.id,
      name: island.name,
      type: args.type,
      order: args.order,
      removed: doomed.length,
      ordinalsRemoved: { from: ordinal(doomed.at(-1).id), to: ordinal(doomed[0].id) },
      buildings: { before: Object.values(before).reduce((a, b) => a + b, 0), after: island.buildings.length },
      [args.type]: { before: before[args.type], after: after[args.type] ?? 0 },
      stateBytes: { before: state.length, after: nextState.length },
      snapshot: { at: row.at, lineCount: Number(row.line_count) },
      dry: args.dry,
    };

    if (args.dry) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ ...report, applied: false }, null, 2));
      return;
    }

    await client.query("UPDATE world_snapshot SET state = $1 WHERE id = 1", [nextState]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ...report, applied: true }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
