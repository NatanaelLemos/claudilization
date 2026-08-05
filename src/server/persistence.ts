import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { Balance } from "../shared/balance";
import { DEFAULT_BALANCE } from "../shared/balance";
import { parseOrders } from "../shared/orders";
import type { CivId, DebugGrant } from "../shared/types";
import { World } from "./world";

/**
 * Durability: append-only command log + periodic snapshots, behind a
 * CommandStore so the same event-sourced world lives equally well in local
 * JSONL files (dev, tests) or Postgres (production — survives any restart).
 * Restart replays snapshot + log tail. The snapshot cadence
 * (balance.snapshotIntervalSeconds ≤ 300) bounds restart cost; a resolved
 * record() means the command is durable.
 */
export type WorldCommand =
  | {
      type: "create";
      at: number;
      seed: number;
      balance?: Partial<Balance>;
      /** the real instant this world's clock reads zero — the wall-clock anchor */
      anchorMs?: number;
    }
  | {
      type: "join";
      at: number;
      civ: string;
      secret?: string;
      publicKey?: string;
      name?: string;
    }
  | { type: "pulse"; at: number; secret: string; tokens: number }
  | { type: "orders"; at: number; secret: string; orders: unknown }
  | { type: "rename"; at: number; secret: string; name: string }
  | { type: "pair"; at: number; secret: string; publicKey: string }
  | { type: "grant"; at: number; islandId: string; grant: unknown }
  | { type: "rebalance"; at: number; balance: Partial<Balance> };

export interface Snapshot {
  at: number;
  lineCount: number;
  state: string;
}

/** Where the log and snapshot live. Appends are durable when resolved, in call order. */
export interface CommandStore {
  append(line: string): Promise<void>;
  readLog(): Promise<string[]>;
  saveSnapshot(snap: Snapshot): Promise<void>;
  loadSnapshot(): Promise<Snapshot | null>;
}

export class FileStore implements CommandStore {
  private logPath: string;
  private snapshotPath: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, "log.jsonl");
    this.snapshotPath = join(dir, "snapshot.json");
  }

  async append(line: string): Promise<void> {
    appendFileSync(this.logPath, line + "\n");
  }

  async readLog(): Promise<string[]> {
    if (!existsSync(this.logPath)) return [];
    return readFileSync(this.logPath, "utf8").split("\n").filter(Boolean);
  }

  async saveSnapshot(snap: Snapshot): Promise<void> {
    writeFileSync(this.snapshotPath, JSON.stringify(snap));
  }

  async loadSnapshot(): Promise<Snapshot | null> {
    if (!existsSync(this.snapshotPath)) return null;
    return JSON.parse(readFileSync(this.snapshotPath, "utf8")) as Snapshot;
  }
}

export class PgStore implements CommandStore {
  private pool: pg.Pool;
  /**
   * Commands mutate the in-memory world synchronously, so their durable log
   * must retain append-call order. A promise tail used to achieve that by
   * paying one full Postgres round trip per command, which becomes a latency
   * staircase whenever several pulses land together. Coalesce arrivals over a
   * couple of milliseconds and insert the batch in ordinal order instead;
   * every caller still waits for its own committed INSERT before it resolves.
   */
  private pending: { line: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private draining: Promise<void> | undefined;

  static readonly APPEND_BATCH_WINDOW_MS = 2;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS world_log (
         id BIGSERIAL PRIMARY KEY,
         line TEXT NOT NULL
       )`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS world_snapshot (
         id SMALLINT PRIMARY KEY CHECK (id = 1),
         at DOUBLE PRECISION NOT NULL,
         line_count BIGINT NOT NULL,
         state TEXT NOT NULL
       )`,
    );
  }

  append(line: string): Promise<void> {
    const appended = new Promise<void>((resolve, reject) => {
      this.pending.push({ line, resolve, reject });
    });
    if (!this.flushTimer && !this.draining) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.drain();
      }, PgStore.APPEND_BATCH_WINDOW_MS);
    }
    return appended;
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.pending.length) {
        const batch = this.pending.splice(0);
        try {
          await this.pool.query(
            `INSERT INTO world_log (line)
             SELECT line FROM unnest($1::text[]) WITH ORDINALITY AS batch(line, ordinal)
             ORDER BY ordinal`,
            [batch.map((entry) => entry.line)],
          );
          for (const entry of batch) entry.resolve();
        } catch (error) {
          for (const entry of batch) entry.reject(error);
        }
      }
    })().finally(() => {
      this.draining = undefined;
      // An append can land between the final loop check and this callback.
      if (this.pending.length && !this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = undefined;
          void this.drain();
        }, PgStore.APPEND_BATCH_WINDOW_MS);
      }
    });
    return this.draining;
  }

  async readLog(): Promise<string[]> {
    const res = await this.pool.query<{ line: string }>(
      "SELECT line FROM world_log ORDER BY id",
    );
    return res.rows.map((r) => r.line);
  }

  async saveSnapshot(snap: Snapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO world_snapshot (id, at, line_count, state) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET at = $1, line_count = $2, state = $3`,
      [snap.at, snap.lineCount, snap.state],
    );
  }

  async loadSnapshot(): Promise<Snapshot | null> {
    const res = await this.pool.query<{ at: number; line_count: string; state: string }>(
      "SELECT at, line_count, state FROM world_snapshot WHERE id = 1",
    );
    const row = res.rows[0];
    if (!row) return null;
    return { at: row.at, lineCount: Number(row.line_count), state: row.state };
  }

  async end(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.length) await this.drain();
    else if (this.draining) await this.draining;
    await this.pool.end();
  }
}

export class Persistence {
  private lineCount = 0;
  private lastSnapshotAt = -Infinity;

  private constructor(private store: CommandStore) {}

  static async open(store: CommandStore): Promise<Persistence> {
    const p = new Persistence(store);
    p.lineCount = (await store.readLog()).length;
    return p;
  }

  async record(cmd: WorldCommand): Promise<void> {
    await this.store.append(JSON.stringify(cmd));
    this.lineCount++;
  }

  async maybeSnapshot(world: World): Promise<void> {
    const interval = DEFAULT_BALANCE.snapshotIntervalSeconds;
    if (world.time - this.lastSnapshotAt < interval) return;
    this.lastSnapshotAt = world.time;
    await this.store.saveSnapshot({
      at: world.time,
      lineCount: this.lineCount,
      state: world.serialize(),
    });
  }

  /** Rebuild the world from snapshot + replayed commands. Null if nothing stored. */
  async restore(): Promise<World | null> {
    const snap = await this.store.loadSnapshot();
    const lines = await this.store.readLog();
    if (!snap && lines.length === 0) return null;

    let world: World | null = null;
    let skip = 0;
    if (snap) {
      world = World.deserialize(snap.state);
      skip = snap.lineCount;
    }

    // the creation line carries the world's wall-clock anchor. A snapshot taken
    // before anchors existed skips that line entirely, so read it here too —
    // the anchor is the world's birth certificate and must survive any restore.
    const born = lines[0] ? (JSON.parse(lines[0]) as WorldCommand) : undefined;
    if (world && born?.type === "create" && born.anchorMs !== undefined && !world.anchor) {
      world.anchorTo(born.anchorMs);
    }

    for (const line of lines.slice(skip)) {
      const cmd = JSON.parse(line) as WorldCommand;
      if (cmd.type === "create") {
        if (!world) {
          world = World.create({
            seed: cmd.seed,
            balance: cmd.balance,
            anchorMs: cmd.anchorMs,
            at: cmd.at,
          });
        }
        continue;
      }
      if (!world) continue;
      if (cmd.at > world.time) world.tick(cmd.at - world.time);
      switch (cmd.type) {
        case "join":
          world.join({
            civ: cmd.civ as CivId,
            secret: cmd.secret,
            publicKey: cmd.publicKey,
            name: cmd.name,
          });
          break;
        case "pair":
          world.pair(cmd.secret, cmd.publicKey);
          break;
        case "pulse":
          world.pulse(cmd.secret, cmd.tokens);
          break;
        case "orders":
          world.applyOrders(cmd.secret, parseOrders(cmd.orders));
          break;
        case "rename":
          world.rename(cmd.secret, cmd.name);
          break;
        case "grant":
          world.debugGrant(cmd.islandId, cmd.grant as DebugGrant);
          break;
        case "rebalance":
          world.rebalance(cmd.balance);
          break;
      }
    }
    return world;
  }
}
