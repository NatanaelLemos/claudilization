# Wave 8 — what is learned is never washed away (2026-08-14)

## The disease

A player report ("the game might be too hard now, it's impossible to level
up") led to the math. Katsu-kaze, medieval, 189 buildings, every medieval
building type already raised — the empty build menu is correct; the age gate
is the only road forward. The age gate could never be reached:

1. **Work income is roughly linear.** `computeInspiration` pays
   `tokens × 0.001 × fatigue` (floor 0.2). The balance file's reference
   steady player (200k tokens/day) earns ~200 work/day; Katsu-kaze's owner,
   playing heavily (~1.5M tokens/day), earned ~1,140/day.
2. **Age costs are exponential.** ×2 per age: renaissance 14,400 →
   industrial 28,800 → modern 57,600 → future 115,200.
3. **Catastrophes taxed the whole cumulative pool.** Every strike removed
   8–20% of an island's *total* accumulated work (mean ~12.5%), at wave 7's
   cadence of ~2.4 strikes/day → ~27% of the pool lost per day, forever,
   dormant islands included.

A proportional drain against linear income is an asymptote, not a ladder:
equilibrium ≈ daily income ÷ 0.274. The reference player ceilings at ~730
work — below even bronze (900). Katsu-kaze ceilings at ~4,200 and was
observed pinned there (4,115 → 4,177 across heavy play). Holding the future
age would have required ~5M tokens/day, sustained forever. No island in the
world would ever have seen the renaissance.

## The law change

**Catastrophes no longer touch work points — at all.** What a civilization
has learned, no wave can wash away. `workPointLossFraction` and
`workPointsLost` are deleted from the catastrophe law, the impact accounting,
the island event text, and the published rules. Strikes keep their teeth
everywhere else: stocks, ground reserves, building damage + repair labor,
docked boats, creation armies.

Merely shielding banked ages was considered and rejected: at the old loss
fractions, next-age progress still ceilings at 11,375 < 14,400 — the
treadmill survives, one age later.

With the drain gone, progress is truly cumulative: Katsu-kaze reaches the
renaissance in ~9 days at its current pace; the reference player climbs
forever at ~200/day, just slowly. Age pacing is now purely the exponential
ladder — tunable later via `rebalance` if it proves too fast.

## The brain now knows where work comes from

The MCP brain prompt never said what fills the age gate, so player-side
agents invented folklore ("work points come from settlers working") and spent
orders chasing it. `decisionPrompt` now states: work points come ONLY from
the player's own completed prompts; no order, settler, or building earns
them, and no catastrophe takes them.

## Compatibility

- Persisted `ActiveCatastrophe.impact.workPointsLost` in old snapshots is an
  extra JSON field on deserialize — ignored structurally, gone at the next
  strike.
- The client banner only ever rendered materials lost; no UI change.
- `advance_age` still spends nothing (the pool is cumulative by design).

## Tests

- `catastrophes.test.ts` — earthquake and Godzilla laws now pin
  `workPoints` exactly unchanged through a strike (1000 → 1000).
- Client fixtures drop the dead field; `tsc --noEmit` enforces the deletion
  everywhere.

555 passing.
