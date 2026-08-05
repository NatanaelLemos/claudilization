// Behavior 5: every completed prompt causes a visible event on the island
// within 10 seconds — watched in a real browser.
import { expect, test } from "@playwright/test";
import { joinGame, pulse } from "./helpers/driver";

test("a pulse lands in the watching browser's feed within 10 seconds", async ({ page }) => {
  const r = await joinGame("japanese");
  await page.goto(`/?key=${r.secret}`);
  await expect(page.getByTestId("island-title")).toHaveText(r.islandName, {
    timeout: 15_000,
  });

  const surges = page.locator('#feed-list li[data-event-type="work-surge"]');
  const before = await surges.count();

  const started = Date.now();
  await pulse(r.secret, 4000);
  await expect
    .poll(async () => surges.count(), { timeout: 10_000 })
    .toBeGreaterThan(before);
  expect(Date.now() - started).toBeLessThanOrEqual(10_000);
});
