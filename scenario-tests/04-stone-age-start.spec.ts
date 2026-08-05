// Behavior 4: a new island starts in the Stone Age — 10 uniquely named adult
// settlers, untouched nature (trees, rock, wild food), no buildings.
import { expect, test } from "@playwright/test";
import { getState, joinGame } from "./helpers/driver";

test("a fresh island is untouched nature plus ten named settlers", async () => {
  const r = await joinGame("egyptian");
  const { island } = await getState(r.secret);

  expect(island.age).toBe("stone");
  expect(island.buildings).toHaveLength(0);
  expect(island.settlers).toHaveLength(10);
  const names = island.settlers.map((s) => s.name);
  expect(new Set(names).size).toBe(10);
  for (const s of island.settlers) expect(s.adult).toBe(true);

  expect(island.natureNodes.wood ?? 0).toBeGreaterThan(0);
  expect(island.natureNodes.stone ?? 0).toBeGreaterThan(0);
  expect(island.natureNodes.food ?? 0).toBeGreaterThan(0);
  expect(island.resourcesUnlocked).toEqual(["food", "wood", "stone"]);
});
