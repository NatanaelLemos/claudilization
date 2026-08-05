// Behavior 15: the story feed narrates; a returning player gets the
// "while you were gone" recap — one line for Claude Code, the full tale
// in the browser, told by name.
import { expect, test } from "@playwright/test";
import { getState, grant, joinGame, pulse, waitFor } from "./helpers/driver";

test("a returning player gets the recap line and the full browser telling", async ({ browser }) => {
  test.setTimeout(180_000);
  const r = await joinGame("roman");

  // the player looks once, then leaves
  const firstVisit = await browser.newPage();
  await firstVisit.goto(`http://localhost:8790/?key=${r.secret}`);
  await expect(firstVisit.getByTestId("island-title")).toHaveText(r.islandName, {
    timeout: 15_000,
  });
  await firstVisit.close();

  // life goes on: a birth (named) happens while they're away
  await grant(r.islandId, {
    stocks: { food: 2000 },
    addBuilding: { type: "hut", stage: "complete" },
  });
  await waitFor(async () => (await getState(r.secret)).island.settlers.length > 10, 45_000);

  // wait past the (test-compressed) away threshold, then "return" in Claude Code
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  const recapLine = (await getState(r.secret)).recapLine;
  expect(recapLine).toContain("While you were gone");

  // more news while away again — then return in the browser
  await pulse(r.secret, 8000);
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  const returnVisit = await browser.newPage();
  await returnVisit.goto(`http://localhost:8790/?key=${r.secret}`);
  const recap = returnVisit.getByTestId("recap");
  await expect(recap).toBeVisible({ timeout: 15_000 });
  await expect(recap).toContainText("While you were gone");
  await returnVisit.close();
});
