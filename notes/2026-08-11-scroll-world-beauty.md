# Scroll World beauty pass — 2026-08-11

Goal: close the gap between the live clay-diorama look and the Scroll World
diorama aesthetic (soft matte clay, composed placement, warm studio lighting,
tilt-shift miniature finish) without touching gameplay, saves, determinism, or
the instanced-rendering performance wins.

## What changed

1. **Composition, not scatter** — every wood node is now a grove: the
   harvestable tree stands at the node in one of three clay species
   (broadleaf, pine, cypress) tinted from per-island canopy pots; companion
   trees cluster round it. Companions live in the distance-culled decoration
   layer, so a distant island pays exactly the old one-tree-per-node budget.
   Stone nodes render as sculpted two-boulder outcrops instead of lone
   pebbles. Meadow clearings with clay blooms and shrubs (instance-tinted,
   no picks) fill the negative space. All of it deterministic from the seed
   (`|groves`, `|outcrops`, `|meadow` streams — the `|nature` stream and
   node RNG are untouched, so wilds and saves render where they always did).
2. **Terrain relief** — `surfaceY()` shapes visual relief only: interior
   swells into rolling hills (up to +3.8 over the flat ramp), shores bank
   round and dip faster under the sea. Every placed thing reads its ground
   through the same function, so buildings, settlers, paths and props sit
   correctly and tile logic never moves. Terrain color is an elevation ramp
   (bright meadow → working green → moss → warm banded rock strata) from the
   per-island palette instead of four flat pots.
3. **Paths + grounds** (`groundsView.ts`) — completed buildings are joined by
   a minimum-spanning-tree network of clay stepping-stone footpaths (capped
   at 900 stones, door gaps kept, never in the sea), and each building gets
   a working yard by type: field rows + fences at farms, market awnings in
   civ colors, drying racks at docks, crates/barrels at workshops, banner
   pennants at civic buildings, domestic clutter at homes. One instanced
   mesh per prop shape+color; whole layer hidden beyond 340.
4. **Lighting + post** — the key sun rides lower (long soft shadows all
   day). New single-pass post pipeline (`postEffects.ts`): tilt-shift focus
   band (9 taps), warm grade, mild saturation, soft vignette; MSAA-preserving
   half-float target; sRGB output via `colorspace_fragment`. Runs only on
   desktop at `high` quality without reduced-motion; adaptive-quality
   downgrades switch it off first. `?post=1/0` pins it for tooling.
5. **Palette cohesion** — `islandPalette(seed)`: every decorative hue on an
   island (canopies, blooms, shrubs, soil, boulders, terrain ramp) draws
   from one small seeded pot set, drifting at most ~0.065 hue from the shared
   clay palette. Islands vary like neighbouring valleys, not different games.
6. **Settler grounding** — figures cast no shadow maps (1,024 instances x 7
   parts), so each settler now gets an instanced soft contact blob glued to
   the ground under its feet, breathing smaller as the body bobs. One basic-
   material draw per island, zero shadow cost.

Markers: `data-beauty="scroll-diorama-v1"`, `data-post-support` /
`data-post="tilt-shift-post-v1"|"off"` beside the existing
`miniature-clay-v1` and `clay-water-waves-v1`.

## Budget (scripts/decor-benchmark.ts, 166-cell island + 60 buildings)

- Always visible (nature + resources): 27 draws, ~89.8k triangles — baseline
  before the pass was 25 draws, ~83.9k (+2 draws, +7% triangles).
- Distance-culled: meadows + grove companions 6 draws / ~16.9k tris (hidden
  beyond 260); paths + yards 12 draws / ~20.7k tris (hidden beyond 340) —
  culled by the existing 0.5 s shadow-budget sweep in `main.ts`.
- Dense-building benchmark unchanged: 99.83% draw/shadow reduction.
- Water untouched: 1 draw, 0 textures.

## Evidence

- `notes/evidence/2026-08-11-before-desktop.png` / `-mobile.png` — production
  v32 before the pass.
- `notes/evidence/2026-08-11-after-desktop.png` / `-mobile.png` — production
  v33 after the pass, captured live post-deploy.
- Captured with `scripts/capture-evidence.mjs` (local headless Chromium +
  SwiftShader; the pooled browser still has no WebGL).

## Honest gaps vs the Scroll World stills

- Scroll World frames are offline GPT-image renders; ours is a live 60 fps
  renderer. Their per-pixel global illumination, contact occlusion and
  perfect art direction per frame are out of reach in real time at this
  budget.
- Island sides are still ocean shoreline, not a floating clay plinth with
  visible strata — the world is an ocean with boats, so islands sit in the
  sea by design.
- No baked ambient occlusion; grounding relies on soft shadows + contact
  blobs.
- The tilt-shift is screen-space (no depth-aware bokeh) and off on mobile,
  reduced-motion, and degraded-quality machines.

## Scenario-suite note

Scenario 21's terrain-drain poll (all islands built after load) is timing
sensitive under SwiftShader once the suite has created a large world; it
passes in isolation and the drain remains one island per frame.
