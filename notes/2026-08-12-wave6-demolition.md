# Gauntlet wave 6 — the town tears down what makes no sense (2026-08-12)

Wave 5 paved the town; wave 6 gives it the power to unmake. The world could
only ever add buildings — nothing but a catastrophe had ever removed one — so
every stray a young town raised stood forever, and the audit's verdict had
nowhere to land.

## Cycle 1 — the demolish law

- **What changed.** `3ed372a`: `demolish` enters the closed order vocabulary
  (`src/shared/orders.ts`, `src/shared/types.ts`) and its law lives in
  `World.applyDemolish` (`src/server/world.ts`).
  - shape `{ kind: "demolish", building: <id or type>, island?: <island id> }`;
    naming a type razes the first of that type standing.
  - **soil law:** the island defaults to the ruler's home and may otherwise
    only be a colony their home rules. Provenance decides, never the mutable
    `kind` — another player's founding island is refused whatever the payload
    claims, and so is a rival's colony.
  - wonders are refused; there is no refund and no rubble timer — the ground
    comes free the same instant.
  - every settler whose task pointed at the building (`build`, `relax`) is
    freed to idle, and a resident's `houseId` is cleared.
  - the razing lands in the island's feed as a `demolished` event, so it shows
    up in the world's news like any other moment.
  - it rides the ordinary `orders` command, so it persists and replays through
    the existing event log with no new command type.
- **Tests.** `src/server/demolish.test.ts`, 12 cases: vocabulary shape, raze by
  id (stocks unchanged, no site left behind), raze by type, wonder refusal,
  absent-building refusal, settler release (and the bystander who keeps
  working), the feed event, colony razing, another player's home refused, a
  rival's colony refused, an island that does not exist, and a byte-identical
  log replay (`world.serialize()` equality after restore).
- **Gates.** 545 tests pass (up from 533 — 12 new), `tsc --noEmit` clean,
  production build clean. Deployed to Fly; `GET /api/rules` on the live host
  lists `demolish` last in `orderKinds` and carries its shape.

## Cycle 2 — applying the raze list

The audit (`scripts/audit-buildings.ts`, evidence
`notes/evidence/2026-08-12-building-audit.json`) scored all 282 buildings on
Nate's 8 islands against the game's own laws — `townPlan` district scoring,
`buildingDemand`, and the `happiness` need providers. The condemnation law: a
building falls only if it has no mechanical role AND stands off the street
skeleton or breaks its own district law (mine far from its lode, wall deep
inland, in water or on rock), or if it duplicates a civic need already answered
AND stands off the skeleton more than 12 tiles from the plaza. Housing, food
producers, wonders, the harbour pair and the last provider of any need were
never eligible.

`scripts/raze.ts` issued the 38 signed demolish orders in four batches of ten.
**Razed 38, refused 0.**

| island | buildings before → after | condemned | gone | new |
| --- | --- | --- | --- | --- |
| island-2674 (home) | 39 → 30 | 9 | 9 | 0 |
| island-8745 | 33 → 30 | 3 | 3 | 0 |
| island-8921 | 34 → 31 | 3 | 3 | 0 |
| island-8996 | 35 → 31 | 4 | 4 | 0 |
| island-9083 | 36 → 28 | 8 | 8 | 0 |
| island-9158 | 37 → 33 | 4 | 4 | 0 |
| island-9233 | 35 → 30 | 5 | 5 | 0 |
| island-9303 | 33 → 31 | 2 | 2 | 0 |
| **total** | **282 → 244** | **38** | **38** | **0** |

Re-captured live over the world socket after the razing: the exact 38 condemned
ids are gone, **zero collateral losses**, and nothing had been rebuilt in the
window. Re-running the audit on the after-state: flagged buildings 199 → 161,
exactly −38, so every removal was a flagged one and no removal created a new
fault anywhere.

## Blind verdict — does the town read more coherent?

Live frames after the razing: `notes/evidence/2026-08-12-w6-after-desktop.png`
(dusk) and `-day-desktop.png` (midday), plus the mobile pair.

- **Yes, on the strays.** The home island now reads as *one* town: a single
  dense block on the north rise with the road ribbon leaving it westward to the
  shore. Nothing stands alone in the meadow any more — the 6–8-tile outliers
  (campfire, pottery-workshop, chariot-works, flint-knapper) that used to speckle
  the grass around the core are the ones that fell, and the silhouette is
  correspondingly tighter.
- **Where the roads run, it helps most.** The ribbon now passes only built
  ground and open meadow; before, it ran past detached single buildings that
  belonged to no district and made the road look like it was going nowhere in
  particular.
- **Honest limits.** (1) No pre-raze frame exists at the same camera and hour,
  so the visual verdict leans on the data plus what is *absent* in the frame,
  not on a matched A/B. (2) The plaza still reads as a bare brown disc — the
  wave-4 finding stands and demolition does not touch it. (3) 161 buildings are
  still flagged by the audit, dominated by 83 "no mechanical role" decorations
  that sit correctly on the street skeleton — they are texture, not error,
  under the current law. (4) Nothing stops the settlers rebuilding what demand
  still wants: `autoPlan` answers unmet demand every day, so a razed provider
  can come back. Removals here were duplicates and roleless works, which demand
  does not ask for, but this is worth re-checking on the next capture.

## Standing targets after wave 6

1. **The plaza still reads as a hole** (carried from wave 4) — the loudest
   remaining loss in the frame.
2. **Farmland belt law is widely broken**: 16 farm buildings sit inside the
   plaza belt they should ring. A demolition is the wrong tool — this wants a
   relocation or a corrected build site.
3. **Duplicate warmth**: 12 buildings duplicate the "warm" need already
   answered by the kiln, and they stand *on* the skeleton, so the condemnation
   law spares them. Either the need law should cap providers or the town should
   stop building them.
4. **Walls deep inland** (8) — the perimeter law wants ~2.5 tiles from shore.
5. **Squatting the founding plaza** (8) — buildings inside the plaza radius
   that are neither civic nor service.
6. **Re-capture in a day** to confirm nothing razed has been rebuilt.

## Evidence and tooling committed

- `scripts/audit-buildings.ts` — the scoring pass (reads `/tmp/islands.json`).
- `scripts/capture-islands.mjs` — live island capture over the world socket;
  the watch secret now comes from `~/.claudilization/identity.json` or
  `CLZ_SECRET`, never from source.
- `scripts/raze.ts` — applies a raze list as signed demolish orders.
- `notes/evidence/2026-08-12-building-audit.json` — all 282 buildings scored.
- `notes/evidence/2026-08-12-raze-list.json` — the 38 condemned.
