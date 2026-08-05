import { describe, expect, it, vi } from "vitest";
import { PgStore } from "./persistence";

describe("PgStore concurrent append batching", () => {
  it("turns a latency staircase into one durable ordered insert", async () => {
    const store = new PgStore("postgres://unused");
    const queries: { sql: string; values?: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      await new Promise((resolve) => setTimeout(resolve, 35));
      return { rows: [] };
    });
    const end = vi.fn(async () => undefined);
    store["pool"] = { query, end } as never;

    const lines = Array.from({ length: 25 }, (_, index) => `line-${index}`);
    const started = performance.now();
    await Promise.all(lines.map((line) => store.append(line)));
    const elapsed = performance.now() - started;

    expect(query).toHaveBeenCalledTimes(1);
    expect(queries[0]?.values?.[0]).toEqual(lines);
    // A serialized 25 × 35 ms path takes at least 875 ms.
    expect(elapsed).toBeLessThan(200);
    await store.end();
    expect(end).toHaveBeenCalledOnce();
  });

  it("does not acknowledge any member before its batch commit", async () => {
    const store = new PgStore("postgres://unused");
    let release!: () => void;
    const committed = new Promise<void>((resolve) => { release = resolve; });
    store["pool"] = {
      query: vi.fn(async () => { await committed; return { rows: [] }; }),
      end: vi.fn(async () => undefined),
    } as never;
    const settled: number[] = [];
    const appends = [0, 1, 2].map((index) => store.append(`line-${index}`).then(() => settled.push(index)));
    await new Promise((resolve) => setTimeout(resolve, PgStore.APPEND_BATCH_WINDOW_MS + 10));
    expect(settled).toEqual([]);
    release();
    await Promise.all(appends);
    expect(settled).toEqual([0, 1, 2]);
    await store.end();
  });

  it("rejects the whole batch on a failed durable insert and accepts a later batch", async () => {
    const store = new PgStore("postgres://unused");
    const query = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ rows: [] });
    store["pool"] = { query, end: vi.fn(async () => undefined) } as never;
    const first = await Promise.allSettled([store.append("a"), store.append("b")]);
    expect(first.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
    await expect(store.append("c")).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    await store.end();
  });
});
