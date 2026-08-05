// Behavior 11: total loss is announced to the world, leaves ruins on the map,
// and the player may found anew.
import { expect, test } from "@playwright/test";
import { joinGame, grant, waitFor, worldSummary } from "./helpers/driver";

test("the last death is a world moment; ruins remain; the player founds anew", async ({ page }) => {
  const r = await joinGame("aztec");

  // a spectator is already watching somewhere else in the world
  await page.goto("/");
  await expect(page.locator("#world")).toBeVisible();

  await grant(r.islandId, { stocks: { food: 0 }, clearFoodSources: true });

  await waitFor(async () => {
    const w = await worldSummary();
    return w.islands.find((i) => i.id === r.islandId)?.ruins;
  }, 90_000);

  // announced to everyone, even spectators watching other islands
  const moment = page.locator('#feed-list li[data-event-type="extinction"]');
  await expect(moment.first()).toContainText(r.islandName, { timeout: 15_000 });

  // found anew; the ruins stay on the map
  const rejoin = await joinGame("aztec", r.secret);
  expect(rejoin.isNew).toBe(true);
  expect(rejoin.islandId).not.toBe(r.islandId);
  const w = await worldSummary();
  expect(w.islands.find((i) => i.id === r.islandId)?.ruins).toBe(true);
});
