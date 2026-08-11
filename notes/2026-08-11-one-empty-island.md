# One empty island at a time — 2026-08-11

Nate's rule, verbatim: "a new empty island should only show up if there's no
empty islands in the map! If there's at least one island without any players in
it, do not create a new empty island."

## What "empty" means here

The codebase already has an exact occupancy notion: `kind === "wild"` — land
that rose from the sea unclaimed, with no settlers, no owner, and no civ. It is
what the game itself calls empty ("An empty island rises from the sea", "only
an empty island can be colonized"). Homes and colonies are claimed; ruins are
dead, not empty (and can never be colonized, so they must never block the
spawner). The gate therefore counts `kind === "wild" && !ruins`.

## The change

`World.maybeSpawnWild` is the only code path in the game that creates an empty
island (the only other island creator is `join`, which founds an *occupied*
home island). The old law capped wild islands at `ceil(homes × maxWildPerHome)`
— with 6 homes live, 6 empty islands piled up. The new law: a new empty island
rises only when **zero** empty islands wait on the map. One vacancy at a time.
The `maxWildPerHome` balance knob is retired with the law it enforced; old
saves and `rebalance` log lines carrying the key load unchanged (unknown keys
are inert at runtime).

## Why joins are untouched

A join founds an occupied home island — it never creates empty land, so the
rule does not apply to it. Making joiners claim an existing wild island instead
was considered and rejected: the game's supreme law couples "home" with "born
as home" (`origin` is written at birth and never changed, so no formerly-empty
land can ever inherit a home's sanctity — the anti-forgery double lock in
`sacred()`). A joiner landed on former empty land would either be attackable
(breaking "home islands are sacred") or require mutating the immutable origin
field. Empty islands are claimed the way they always were: colonization
voyages, first come first served.

## Determinism

The gate changes *when* generation runs, never *how*: wild seeds still derive
from `seed|wild|n`, join seeds from `seed|island|n`, and no RNG stream is
touched. Existing worlds load unchanged; the six live vacancies persist until
colonized. New test: two identically driven worlds serialize byte-equal
through a spawn → colonize → respawn cycle.
