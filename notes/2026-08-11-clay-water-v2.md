# Miniature sea pass (clay-water-waves-v2) — 2026-08-11

Goal: make the ocean as beautiful as the islands — a stylized tabletop
diorama sea with depth, waves and shoreline life — without touching gameplay,
saves, determinism, or the one-draw water budget.

## What changed

1. **World bathymetry field** (`waterDepthField.ts`) — when an island's
   terrain builds (the existing one-per-frame stream), it stamps its *actual*
   tile heights plus a per-island lagoon turquoise
   (`islandPalette(seed).lagoon`, derived from the palette season with no new
   RNG draws) into one RGBA8 data texture covering the ocean plane
   (2048² desktop / 1024² mobile; R,G,B = lagoon tint, A = height/0.25).
   No second `generateIsland`, no RNG stream touched — the stamp re-reads the
   terrain already generated for the island mesh (`group.userData.terrain`).
2. **Sea shader v2** (`waterSurface.ts`, marker `clay-water-waves-v2`) —
   still one `MeshStandardMaterial` plane, one draw call:
   - depth-graded color: each island's lagoon banks down to the sky rig's
     deep blue; the last metre warms over the sand floor;
   - soft clay contact foam hugging the real coastline, edge breathing with
     time, broken up along the shore; slow lapping rings rolling in;
   - quiet elongated crest bands out at sea (the old polka-dot ripples are
     gone) plus slow painterly patches so open water never reads flat;
   - desktop (`WATER_SHEEN` define): analytic wave-slope normals + scattered
     sun glitter — the warm key sun lays moving satin glints; roughness 0.5
     satin "resin-pour" water; mobile stays matte 0.62 with none of it;
   - swells calm as the sea shallows (vertex reads the field);
   - everything scales with `rig.dayness` — shallows, foam and glints dim to
     a moonlit sea at night.
3. **Wiring** — `Stage.stampWater()` in `scene.ts`; `main.ts` stamps on
   `buildTerrain`; daylight uniform follows `applyTimeOfDay`.

## Determinism & saves

Tile positions, buildings, docks, nature nodes, the `|nature` stream and node
RNG are untouched. The field is a pure function of (position, seed, terrain);
identical stamps produce identical bytes (tested).

## Perf

- Ocean stays **1 draw call**; +1 texture (16.8 MB desktop / 4.2 MB mobile),
  uploaded only when an island stamps (streaming start, joins, colonies).
- Fragment adds one texture fetch + ~a dozen transcendentals; vertex adds one
  fetch. Reduced motion still freezes the clock; mobile throttles to 20 Hz.
- Sheen/glitter compile out on mobile via the define.

## Evidence

- `notes/evidence/2026-08-11-water-before-*.png` — production v33.
- `notes/evidence/2026-08-11-water-after-*.png` — production after deploy.

## Honest gaps

- Foam resolution is field-texel bound (~2.5 units desktop, ~5 mobile): tiny
  bays soften. Deliberate — painted clay foam, not simulation.
- Boats do not bob with the swell (they never did); swell amplitude is small.
- Glitter is procedural sine-product, not real sun-vector specular; the
  sheen normals carry the true sun response.
