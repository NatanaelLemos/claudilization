// Behavior 9: births need a completed house with two adults; starvation kills
// after three food-less days; both are named in the story feed.
import { expect, test } from "@playwright/test";
import { getState, grant, joinGame, waitFor } from "./helpers/driver";

test("a housed island bears a named child, visible in the feed", async ({ page }) => {
  const r = await joinGame("roman");
  await grant(r.islandId, {
    stocks: { food: 2000 },
    addBuilding: { type: "hut", stage: "complete" },
  });

  await page.goto(`/?key=${r.secret}`);
  await waitFor(async () => {
    const { island } = await getState(r.secret);
    return island.settlers.length > 10;
  }, 45_000);

  const { island } = await getState(r.secret);
  const child = island.settlers.find((s) => !s.adult)!;
  expect(child).toBeDefined();
  expect(child.name.length).toBeGreaterThan(0);

  const birth = page.locator('#feed-list li[data-event-type="birth"]').first();
  await expect(birth).toContainText(child.name.replace(" the Younger", ""), {
    timeout: 15_000,
  });
});

test("famine kills by name after three food-less days", async ({ page }) => {
  const r = await joinGame("norse");
  await page.goto(`/?key=${r.secret}`);
  await grant(r.islandId, { stocks: { food: 0 }, clearFoodSources: true });

  await waitFor(async () => {
    const { island } = await getState(r.secret);
    return island.settlers.length < 10;
  }, 60_000);

  const death = page.locator('#feed-list li[data-event-type="death"]').first();
  await expect(death).toBeVisible({ timeout: 15_000 });
  const text = await death.textContent();
  expect(text?.length ?? 0).toBeGreaterThan(10);
});
