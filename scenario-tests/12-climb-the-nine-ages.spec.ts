// Behavior 12: advancing an age is gated on work, announced in every
// connected browser within 10 seconds, and unlocks the new age's buildings.
import { expect, test } from "@playwright/test";
import { getState, grant, joinGame, pulse, sendOrders } from "./helpers/driver";

test("an age-up is refused until earned, then announced to every browser", async ({ browser }) => {
  const r = await joinGame("japanese");
  await pulse(r.secret, 1000);

  const playerPage = await browser.newPage();
  const spectatorPage = await browser.newPage();
  await playerPage.goto(`http://localhost:8790/?key=${r.secret}`);
  await spectatorPage.goto("http://localhost:8790/");
  await expect(playerPage.getByTestId("island-title")).toHaveText(r.islandName, {
    timeout: 15_000,
  });

  // not yet earned
  const refused = await sendOrders(r.secret, [{ kind: "advance_age" }]);
  expect(refused.outcomes[0]!.ok).toBe(false);
  expect(refused.outcomes[0]!.reason).toBeTruthy();

  // earned: strictly harder each age is unit-tested; here we advance once.
  // Enough for bronze (900) but short of iron (1800) — a bigger grant crosses
  // several ages in one batch and the banner only ever shows the last one.
  await grant(r.islandId, { workPoints: 1000 });
  const granted = await sendOrders(r.secret, [{ kind: "advance_age" }]);
  expect(granted.outcomes[0]!.ok).toBe(true);

  // announced in EVERY connected browser within 10 seconds
  await expect(playerPage.getByTestId("banner")).toContainText("bronze", {
    timeout: 10_000,
  });
  await expect(spectatorPage.getByTestId("banner")).toContainText("bronze", {
    timeout: 10_000,
  });

  // the island transformed: bronze unlocks its buildings
  const { island } = await getState(r.secret);
  expect(island.age).toBe("bronze");
  expect(island.buildable.some((b) => b.type === "dock")).toBe(true);
  expect(island.resourcesUnlocked).toContain("copper");

  await playerPage.close();
  await spectatorPage.close();
});
