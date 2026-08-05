// Behavior 13: boats from the Bronze Age; a visible crossing; arrival
// resolves as trade (both stocks change) or help — steered by the test seam.
import { expect, test } from "@playwright/test";
import { getState, grant, joinGame, pulse, sendOrders, waitFor, worldSummary } from "./helpers/driver";

test("a bronze-age boat sails out, trades, and both islands' stocks change", async ({ page }) => {
  test.setTimeout(240_000);
  const a = await joinGame("norse");
  const b = await joinGame("greek");

  // a real boat-building player is an active player — keep the island awake
  // through the long waits, or (correctly) dormancy freezes the shipyard
  const keepAwake = setInterval(() => {
    void pulse(a.secret, 500).catch(() => {});
  }, 8000);

  try {
    await grant(a.islandId, {
      age: "bronze",
      addBuilding: { type: "dock", stage: "complete" },
      stocks: { food: 3000, wood: 200, stone: 50 },
    });
    await grant(b.islandId, { stocks: { food: 3000, wood: 10, stone: 60 } });

    // boats are earned, not given: build one through the order vocabulary
    const build = await sendOrders(a.secret, [{ kind: "build_boat" }]);
    expect(build.outcomes[0]!.ok).toBe(true);
    await waitFor(async () => {
      const { island } = await getState(a.secret);
      return island.boats.some((boat) => boat.state === "docked");
    }, 90_000);

    const bWoodBefore = (await getState(b.secret)).island.stocks.wood ?? 0;
    const aStoneBefore = (await getState(a.secret)).island.stocks.stone ?? 0;

    await page.goto(`/?key=${a.secret}`);
    // events are fleeting toasts now — start watching BEFORE the voyage so the
    // first-voyage world moment is caught the instant it appears
    const worldMoment = expect(
      page.locator('#feed-list li[data-event-type="first-voyage"]').first(),
    ).toBeVisible({ timeout: 150_000 });
    const voyage = await sendOrders(a.secret, [
      { kind: "voyage", dest: b.islandId, intent: "trade" },
    ]);
    expect(voyage.outcomes[0]!.ok).toBe(true);

    // the crossing is visible: the boat is at sea
    await waitFor(async () => {
      const w = await worldSummary();
      return w.islands
        .find((i) => i.id === a.islandId)!
        .boats.some((boat) => boat.state === "sailing");
    }, 15_000);

    // arrival: trade changes stocks on BOTH islands
    await waitFor(async () => {
      const bNow = (await getState(b.secret)).island.stocks.wood ?? 0;
      const aNow = (await getState(a.secret)).island.stocks.stone ?? 0;
      return bNow > bWoodBefore && aNow > aStoneBefore;
    }, 120_000);

    // the first-ever voyage between two islands is a world moment
    await worldMoment;
  } finally {
    clearInterval(keepAwake);
  }
});
