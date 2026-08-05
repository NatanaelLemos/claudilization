// Behavior 14: players chat, attributed by island and civilization;
// spectators read but have no input field.
import { expect, test } from "@playwright/test";
import { joinGame, pulse } from "./helpers/driver";

test("a player's message reaches every browser, attributed; spectators cannot write", async ({ browser }) => {
  const r = await joinGame("japanese");
  await pulse(r.secret, 1000);

  const playerPage = await browser.newPage();
  const spectatorPage = await browser.newPage();
  await playerPage.goto(`http://localhost:8790/?key=${r.secret}`);
  await spectatorPage.goto("http://localhost:8790/");
  await expect(playerPage.getByTestId("island-title")).toHaveText(r.islandName, {
    timeout: 15_000,
  });

  await expect(playerPage.getByTestId("chat-input")).toBeVisible();
  await expect(spectatorPage.getByTestId("chat-input")).toBeHidden();

  const message = `The tide is kind today (${Date.now()})`;
  await playerPage.getByTestId("chat-input").fill(message);
  await playerPage.getByTestId("chat-input").press("Enter");

  for (const page of [playerPage, spectatorPage]) {
    const entry = page.getByTestId("chat-list").locator("li").last();
    await expect(entry).toContainText(message, { timeout: 10_000 });
    await expect(entry).toContainText(r.islandName);
    await expect(entry).toContainText("Japanese");
  }
  await playerPage.close();
  await spectatorPage.close();
});
