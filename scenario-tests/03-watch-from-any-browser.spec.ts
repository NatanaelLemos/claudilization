// Behavior 3: anyone can watch without an account; a spectator's first view
// is never blank — it lands on the most recently active island.
import { expect, test } from "@playwright/test";
import { joinGame, pulse } from "./helpers/driver";

test("a spectator lands on a living island, with no way to play", async ({ page }) => {
  const player = await joinGame("aztec");
  await pulse(player.secret, 5000); // make this island the most recently active

  await page.goto("/");
  await expect(page.locator("#world")).toBeVisible();
  // never dead air: the camera focuses a real island and the HUD names it
  await expect(page.getByTestId("island-title")).toHaveText(player.islandName, {
    timeout: 15_000,
  });
  // spectators simply have no input field
  await expect(page.getByTestId("chat-input")).toBeHidden();
});
