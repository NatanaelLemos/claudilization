import { readFile } from "node:fs/promises";
import pg from "pg";

const inputPath = process.argv[2];
const connectionString = process.env.DATABASE_URL ?? process.env.CLAUDILIZATION_DB;
if (!inputPath || !connectionString) {
  throw new Error("usage: DATABASE_URL=... RELEASE_RESTORE_CONFIRM=claudilization node scripts/restore-database.mjs <export.json>");
}
if (process.env.RELEASE_RESTORE_CONFIRM !== "claudilization") {
  throw new Error("refusing restore without RELEASE_RESTORE_CONFIRM=claudilization");
}

const rawBackup = JSON.parse(await readFile(inputPath, "utf8"));
const backup = rawBackup.format === "claudilization-db-export-v1"
  ? rawBackup
  : rawBackup.world_log && rawBackup.world_snapshot
    ? {
        format: "claudilization-db-export-v1",
        tables: [
          { name: "world_log", rows: rawBackup.world_log },
          { name: "world_snapshot", rows: rawBackup.world_snapshot },
        ],
        sequences: [{
          name: "world_log_id_seq",
          last_value: Math.max(1, ...rawBackup.world_log.map((row) => Number(row.id))),
          is_called: rawBackup.world_log.length > 0,
        }],
      }
    : null;
if (!backup) throw new Error("unsupported backup format");
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  for (const table of [...backup.tables].reverse()) {
    await client.query(`TRUNCATE TABLE ${quote(table.name)} RESTART IDENTITY CASCADE`);
  }
  for (const table of backup.tables) {
    for (const row of table.rows) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const values = columns.map((column) => row[column]);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      await client.query(
        `INSERT INTO ${quote(table.name)} (${columns.map(quote).join(", ")}) VALUES (${placeholders})`,
        values,
      );
    }
  }
  for (const sequence of backup.sequences) {
    await client.query("SELECT setval($1::regclass, $2, $3)", [sequence.name, sequence.last_value, sequence.is_called]);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ restored: backup.tables.map((table) => ({ name: table.name, rows: table.rows.length })) }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
