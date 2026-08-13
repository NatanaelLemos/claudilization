# Wave 7 — the living land (2026-08-13)

## The disease

The 2026-08-13 investigation found the whole 45-island world past the point of
no return: 691 of Portus Solis's 836 nodes stone-dry, every gatherable vein on
all 8 home islands at `remaining: 0`, 100% of settlers idling in `relax`.
Three compounding laws caused it:

1. **Nodes were finite and never regenerated** — terrain generation seeded
   fixed deposits; the only operations on `node.remaining` were subtractions.
2. **A global catastrophe fired every in-game day** (`catastropheIntervalSeconds
   === daySeconds === 3600`) and `applyCatastrophe` looped over every island in
   the world, shaving 12–25% of every stock, and (volcano) 12% of the reserves
   still in the ground. 209 strikes in: cumulative stock survival ~10⁻¹⁸.
3. **Nothing produced resources** — farms made food and the steelworks refined
   iron, but every mine, quarry, and derrick in the catalog was decoration.

## The three law changes

### 1. Catastrophes keep no schedule
`selectCatastropheGap` (shared/catastrophes.ts) rolls each follow-up gap
deterministically from `CATASTROPHE_GAP_MULTIPLIERS = [1, 5, 24]` × the base
hour — a strike lands 1h, 5h, or 24h after the last, replay-exact off
(seed, sequence, boundary). Expected cadence drops from 24/day to ~2.4/day.
`CatastropheStatus.intervalSeconds` now reports the rolled gap; the outage
catch-up loop walks the same hops on every restart.

### 2. The land breathes back
`World.regenerate()` runs at every day-turn, after every town's daily
reckoning (so exodus/urgent-harbor law still reads dawn's true state), across
**all** islands — inhabited, wild, dormant, ruined. Each node regrows a share
of its capacity: organic (wood, food) `nodeRegenOrganicShare` 8%/day, mineral
`nodeRegenMineralShare` 2%/day, clamped at capacity. Capacities moved to a
single table in shared/terrain.ts (`NODE_CAPACITY`, `FOOD_SOURCE_CAPACITY`,
`nodeCapacity`) that terrain generation now also reads — birth value and
regrowth ceiling can never drift apart. A wood node is whole in ~13 island
days; ores in ~50. The live world's bare ground refills organics within a
real half-day of deploy.

### 3. The works produce
New `BuildingSpec.yields` — per-day resource output once complete, applied in
`daily()` beside the farm harvest and the refineries:

- lumber-camp (stone, NEW) wood 10 · quarry (stone, NEW) stone 8
- copper-mine copper 5 · tin-mine tin 5 · iron-mine iron 6
- charcoal-burner coal 3 · coal-mine coal 5
- marble-quarry marble 4 · silver-mine silver 3 · gold-mine (classical, NEW) gold 2
- oil-derrick oil 4 · gasworks gas 3 · reactor plutonium 1 · antimatter-lab antimatter 1

Settler judgment: `buildingDemand` demands a producer only when the ground
runs thin (that resource's live nodes below 25% of capacity) and planned
yields don't already cover the spec's rate — virgin islands keep gathering,
and no duplicate works race out of one scarcity. `judgeBuild` priority:
food 0 · dock 1 · **yields 2** · houses 3 · converts 4 · other 5 · joy 6.
New settler task `work`: idle hands with no ground left tend the works (two
to a post, `leastTendedProducer`) before drifting to the parks; dawn resets
them to re-judge; construction drafts tenders before relaxers; the food
invariant can pull them. Volcano "productive" scope now includes yields
buildings. Client: works-tenders wear the builder accent; new types fall into
the mine/workshop archetypes; town plan seats quarry/lumber-camp/gold-mine/
gasworks beside their veins via `INDUSTRY_NODE`.

## Tests

- `regeneration.test.ts` — regrowth rates, capacity clamp, wild islands heal,
  daily-reckoning-before-regen ordering.
- `production.test.ts` — dawn yields, unfinished producers yield nothing,
  thin-ground demand gate, two-to-a-post tending, sites draft tenders.
- catastrophe scheduling tests recompute the rolled gap; a new test proves
  every gap comes from the sanctioned multipliers and all three occur.
- extinction tests pin regen shares to 0 — they test the starvation law.

555 passing.

## Balance notes for the live world

- Existing snapshots carry `catastrophe.intervalSeconds: 3600`; the first
  strike after deploy still lands on the persisted boundary, then rolls.
- New balance keys merge from `DEFAULT_BALANCE` on deserialize; `rebalance`
  can tune regen shares live if recovery is too fast or slow.
