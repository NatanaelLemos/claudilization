import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgStore } from "./persistence";

/**
 * Contract test for the Postgres backend. Runs only when a test database is
 * provided (CLAUDILIZATION_PG_TEST_URL) so the suite stays green on machines
 * without Postgres; FileStore covers the same contract unconditionally in
 * persistence.test.ts.
 */
const url = process.env.CLAUDILIZATION_PG_TEST_URL;

describe.runIf(url)("PgStore — the same contract as the file log", () => {
  let store: PgStore;

  beforeAll(async () => {
    store = new PgStore(url!);
    await store.init();
    // each run starts from a clean slate
    await store["pool"].query("TRUNCATE world_log RESTART IDENTITY");
    await store["pool"].query("DELETE FROM world_snapshot");
  });

  afterAll(async () => {
    await store.end();
  });

  it("appends in call order and reads back verbatim", async () => {
    const lines = Array.from({ length: 25 }, (_, i) => JSON.stringify({ i }));
    // fire without awaiting each — the store must still serialize the order
    await Promise.all(lines.map((l) => store.append(l)));
    expect(await store.readLog()).toEqual(lines);
  });

  it("keeps exactly one snapshot, the latest", async () => {
    expect(await store.loadSnapshot()).toBeNull();
    await store.saveSnapshot({ at: 10, lineCount: 5, state: "{}" });
    await store.saveSnapshot({ at: 20, lineCount: 25, state: '{"newer":true}' });
    expect(await store.loadSnapshot()).toEqual({
      at: 20,
      lineCount: 25,
      state: '{"newer":true}',
    });
  });
});
