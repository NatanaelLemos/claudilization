# Wave 9 — what a Claude imagines, the island builds as a solid

Creations were the one thing in this world that was still a picture: a
pixel-art sprite on a camera-facing billboard. Everything around them —
huts, boats, settlers, boulders, the sea — was geometry. So a player asking
their Claude for a statue got a sticker standing in a diorama.

From this wave there is no 2D path. A creation's art is a **voxel model**, and
the game builds it as real geometry.

## The format (`src/shared/voxel.ts`)

Deliberately the sprite grammar with a third dimension, because models compose
it fluently:

```json
"model": {
  "size": 8,
  "palette": ["#1a1a2e", "#e94560", "#c9d1d9"],
  "layers": [["........", "..0..0..", "..."], "... one grid per height step ..."]
}
```

- `size` 4–16 is the footprint side (X west→east, Z north→south).
- `layers` 2–20, index 0 on the ground; each layer is exactly `size` rows of
  exactly `size` characters: `.` empty, digits index the palette.
- 8 colors, 8–2400 solid voxels. Still data, never code, never a file, never a
  URL — the same closed vocabulary the sprite had.

## The gate (`src/shared/creations.ts`)

One door, as before, and what leaves it always carries a `model`. A design
arriving from an older client with a flat `sprite` is **carved into relief**
(`modelFromSprite`: erosion-distance extrusion, thicker toward the middle of a
shape) and the picture is left at the door. Saves written before this wave are
carved once on load (`carveLegacyCreations`), so nothing in the world renders
flat, ever again.

## The build (`src/client/voxelMesh.ts`)

- **Greedy meshing**: neighbouring voxels of one color merge into single quads,
  interior faces are never emitted. An 11-layer figure is a few dozen
  triangles with wide clean facets, not a wall of cubes.
- **A painted bake**: each facet is tinted by which way it looks (warm top,
  deep underside, the two side pairs a touch apart) plus a small deterministic
  wobble in lightness — the fingerprints in the clay. Vertex colors, one
  shared soft-matte material for the whole ocean.
- Pieces stand on their lowest solid voxel, centered on their own footprint,
  fitted so the longest side is `ART_DIRECTION.sprites.creationScale` (2.4
  world units — taller than a settler, shorter than a hut's ridge).

## The rest of it

- **Renderer** (`creationsView.ts`): units are meshes now, not billboards.
  They walk, turn the short way around toward their heading, ride their stride
  when moving and breathe when standing, cast and receive shadows, and rest on
  the same soft contact blob the settlers use. Bands at sea ride a clay raft.
- **Wire** (`ws.ts`): a design is immutable, so its model crosses to a viewer
  once and only design ids afterwards — two summary arrays per tick (full and
  lean), shared by every client. Full island frames keep the whole design
  (the happiness readout reads its verbs) minus art already known.
- **Posts** (`world.ts`): creations take station on a phyllotaxis spiral out
  from the town instead of a random ±5 scatter — solids several units across
  cannot share a spot.
- **Teaching**: the rulebook's worked example is now a hooded figure in
  voxels; `/claudilization`'s "Create anything" section teaches sculpting
  layer by layer (silhouette, depth on Z, one accent color) and says plainly
  that statues and other still objects are creations too.
- **Self-update**: the swap now refreshes `~/.claude/skills/claudilization/SKILL.md`
  from the new app (`install.ts --skill-only`). Without it a player's slash
  command would teach last month's format forever.

## Verification

- `npm run verify` — 579 unit tests, typecheck clean.
- New: `shared/voxel.test.ts` (format, carving, gate), `client/voxelMesh.test.ts`
  (face culling, merging, winding, fitting), `server/creationAssets.test.ts`
  (specs store models, legacy saves carve on load, models travel once).
- Local world at :8791 with hand-authored statue / dragon / golem models:
  accepted, persisted, rendered, shadowed. Frames in
  `notes/evidence/2026-08-18-solid-creations*.png`.

Not deployed.
