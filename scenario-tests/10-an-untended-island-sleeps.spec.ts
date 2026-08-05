// Behavior 10: no prompts → dormancy; stocks and lives freeze; the next
// pulse wakes the island.
import { expect, test } from "@playwright/test";
import { getState, grant, joinGame, pulse, waitFor, worldSummary } from "./helpers/driver";

test("an unprompted island goes dormant, freezes, and wakes on the next pulse", async () => {
  test.setTimeout(120_000);
  const r = await joinGame("egyptian");
  await grant(r.islandId, { stocks: { food: 500 } });

  // wait past the (test-compressed) dormancy threshold with zero pulses
  await waitFor(async () => {
    const w = await worldSummary();
    return w.islands.find((i) => i.id === r.islandId)?.dormant;
  }, 60_000);

  const before = await getState(r.secret);
  await new Promise((resolve) => setTimeout(resolve, 15_000)); // several day-boundaries
  const after = await getState(r.secret);
  expect(after.island.stocks.food).toBe(before.island.stocks.food);
  expect(after.island.settlers.length).toBe(before.island.settlers.length);

  await pulse(r.secret, 2000);
  const woke = await worldSummary();
  expect(woke.islands.find((i) => i.id === r.islandId)?.dormant).toBe(false);
});
