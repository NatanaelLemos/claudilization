import { createWriteStream } from "node:fs";
import { once } from "node:events";
import pg from "pg";

const outputPath = process.argv[2];
const connectionString = process.env.DATABASE_URL ?? process.env.CLAUDILIZATION_DB;
if (!outputPath || !connectionString) {
  throw new Error("usage: DATABASE_URL=... node scripts/export-database.mjs <output.json>");
}

const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const db = await client.query("SELECT current_database() AS database, current_user AS role, now() AS exported_at");
  const tableResult = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = [];
  for (const { table_name: tableName } of tableResult.rows) {
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    const quoted = `"${tableName.replaceAll('"', '""')}"`;
    const rows = await client.query(`SELECT * FROM ${quoted}`);
    tables.push({ name: tableName, columns: columnsResult.rows, rows: rows.rows });
  }
  const sequenceResult = await client.query(`
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename
  `);
  const sequences = [];
  for (const { sequencename } of sequenceResult.rows) {
    const quoted = `"${sequencename.replaceAll('"', '""')}"`;
    const value = await client.query(`SELECT last_value, is_called FROM ${quoted}`);
    sequences.push({ name: sequencename, ...value.rows[0] });
  }
  await client.query("COMMIT");

  const stream = createWriteStream(outputPath, { mode: 0o600 });
  stream.end(JSON.stringify({ format: "claudilization-db-export-v1", metadata: db.rows[0], tables, sequences }));
  await once(stream, "finish");
  console.log(JSON.stringify({
    outputPath,
    tables: tables.map((table) => ({ name: table.name, rows: table.rows.length })),
    sequences: sequences.length,
  }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
