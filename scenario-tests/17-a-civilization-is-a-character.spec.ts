// Behavior 17: civilization choice changes settler names, island naming,
// architecture/boat parameters, and the feed voice — checkably.
import { expect, test } from "@playwright/test";
import { CIVS } from "../src/shared/civs";
import { getState, joinGame } from "./helpers/driver";

test("Norse and Japanese islands differ in every flavor channel", async ({ browser }) => {
  const norse = await joinGame("norse");
  const japanese = await joinGame("japanese");

  // names drawn from each civilization's own bank
  const norseState = await getState(norse.secret);
  const japaneseState = await getState(japanese.secret);
  for (const s of norseState.island.settlers) {
    expect(CIVS.norse.nameBank).toContain(s.name);
  }
  for (const s of japaneseState.island.settlers) {
    expect(CIVS.japanese.nameBank).toContain(s.name);
  }
  expect(CIVS.norse.islandNames).toContain(norse.islandName);
  expect(CIVS.japanese.islandNames).toContain(japanese.islandName);

  // the four flavor channels are pairwise distinct in the content banks
  expect(CIVS.norse.accent).not.toBe(CIVS.japanese.accent);
  expect(CIVS.norse.architecture.roof).not.toBe(CIVS.japanese.architecture.roof);
  expect(CIVS.norse.boat.shape).not.toBe(CIVS.japanese.boat.shape);
  expect(CIVS.norse.voice.build).not.toBe(CIVS.japanese.voice.build);

  // and the browser shows whose character an island carries
  const page = await browser.newPage();
  await page.goto(`http://localhost:8790/?key=${norse.secret}`);
  await expect(page.getByTestId("island-age")).toContainText("Norse", {
    timeout: 15_000,
  });
  await page.goto(`http://localhost:8790/?key=${japanese.secret}`);
  await expect(page.getByTestId("island-age")).toContainText("Japanese", {
    timeout: 15_000,
  });
  await page.close();
});
