# Gauntlet Round 2 — blind visual critique

Date: 2026-08-20
Frame A: `notes/evidence/reference/townscaper-hero.png` (808x366)
Frame B: `notes/evidence/2026-08-20-gauntlet-r2-desktop.png` (1440x900)
Judged blind on art direction and rendering quality only.

## Scores

| # | Category | Frame A | Frame B |
|---|----------|:-------:|:-------:|
| 1 | Lighting & value structure | 9 | 5 |
| 2 | Ambient occlusion / contact shadows | 9 | 6 |
| 3 | Water rendering | 8 | 5 |
| 4 | Terrain material quality | 9 | 5 |
| 5 | Silhouette & composition | 9 | 3 |
| 6 | Color & grade | 9 | 6 |
| | **Total** | **53** | **30** |

**Winner: Frame A. Still decisive — but no longer a shutout.**
Round 1 lost every category "not close" with two 3s. Round 2 moves AO 3→6, terrain 3→5,
and water up a point without giving anything back. A's remaining lead is now concentrated in
one place: composition. Frame A still reads as a painted object sitting in atmosphere;
Frame B reads as a well-shaded mesh photographed from directly above.

## Measured evidence

- **B meadow value range**: sampled 20px open-grass patches on a grid — 197 (upper-left) down to
  96 (lower-right). Real range now exists (round 1 had none), but the falloff is perfectly
  monotonic across the island: one smooth wash, not lighting.
- **B full-frame histogram**: p25 92, p50 108, p75 139, p99 198. Midtone-locked; nothing in the
  subject breaks 200 — no speculars anywhere.
- **B beach patches**: lower-left mean 169 std 13.2; right mean 103 std 20.0. The difference
  between beaches is vignette, not material. Sand is one flat value.
- **B ocean sparkle**: glints land on every 4th scanline with a constant x-pitch of ~120–140px,
  each 2–4px wide, all identical brightness. A tiled lattice, not stochastic glint.
- **B foam**: longest white run 8px (top coast), 5px (lower-right) — a constant-width hard-edged
  stroke, with a second parallel line just outside it.
- **A comparison**: p1 43 → p99 207 with true 255 highlights on roofs; occlusion under eaves and
  stilts drops to lum 7; warm bounce on undersides; painted texel grain at every scale.

## What round 2 actually won

- Tree contact shadows are legible and correctly sized — trees are planted now, not floating decals.
- The meadow has genuine tonal zoning; the "one flat green" headline from round 1 is closed.
- Offshore orphan foam rings are gone; the turquoise-shelf → navy depth gradient is good art direction.
- Palette is cohesive: teal ocean / warm sand / cool-green land holds together as a scheme.

## Frame B — the three fixes, ranked by payoff

### 1. Silhouette & composition (score 3 — the entire win margin lives here)

**What's in the pixels:** the coastline is a smooth ellipse; walk it and the radius barely
changes. The landform is a single dome, so every tree in every region sits at the same visual
scale and no ridge or valley reads. The island is centered, fills ~90% of frame width, is cropped
at the frame bottom, and has ~210px of empty ocean above it. Nothing in the scene is taller than a
15px tree. At thumbnail size it is a green pill.

**Fix:**
- Perturb the island footprint radius with angular noise: ±0.18R at 3–5 lobes plus ±0.06R at
  11–13 lobes, so you get headlands and bays instead of an ellipse. Carve one deep inlet or
  lagoon that cuts meaningfully inland.
- Break the single dome: add a ridge or plateau at 2–3x current max height with a visibly shaded
  far side, and place the plaza on or against it so the settlement has a landmark.
- Recompose: drop camera pitch 10–15° and yaw slightly so the new ridge reads in profile against
  sky; put the island on the lower-left third with sky above rather than dead-centered and cropped.

### 2. Terrain surface detail and slope response (score 5)

**What's in the pixels:** the tonal patches are >150px across with no edge anywhere in them, and
not a single geometry facet is visible in the meadow despite the terrain being faceted underneath.
It reads as a blurred lightmap airbrushed over the ground. The AO/shadow term is a brown multiply
— shaded grass goes muddy olive rather than cool. Beach is a flat unlit tan (std 13).

**Fix:**
- Add a high-frequency vertex-colour term at 1–3m world scale (±6% value, ±0.04 hue) layered on
  top of the existing macro mask, so the surface has grain instead of airbrush.
- Drive value off the real face normal: multiply by `pow(dot(N, L), 0.6)` with a floor near 0.55
  and let individual facets read. Right now the low-poly land is shaded like a smooth sphere.
- Make shade a hue shift, not a brown multiply: rotate hue −8 to −12°, drop value ~25%, keep
  saturation. Cool shadows against warm sun is most of what makes A feel painted.
- Give sand the same treatment: darker wet band 2–4m from the waterline, lighter dry sand inland,
  plus pebble/tuft scatter. One flat tan wedge is the second-largest dead area in the frame.

### 3. Water micro-detail — kill the lattice sparkle and the outline foam (score 5)

**What's in the pixels:** the sparkle is a tiled grid (every 4th scanline, ~120–140px pitch,
identical dashes, identical brightness) and reads as dust on the lens. The foam is a 5–8px
constant-width hard-edged white stroke that traces the coast exactly, with a second parallel line
just outside it — a vector outline, not surf. No reflection, no specular, no seabed through the
shallow shelf, and the island casts nothing onto the water.

**Fix:**
- Delete the sparkle texture. If glints stay, jitter position, scale and brightness stochastically
  and gate them to wave normals facing the key light so they cluster instead of tiling.
- Foam: vary width from ~3px to ~20px around the coast driven by shore slope and wave phase so it
  scallops; feather the outer edge over 6–10px of alpha; punch a noise mask through it (~20%
  dropout) so it isn't continuous; remove the second parallel stroke entirely.
- Anchor the island in the water: darken/tint a ~15px band of water hugging the shore where the
  seabed is close, and cast a soft island shadow onto the water on the shaded side. This alone
  stops the island reading as a sticker pasted on a gradient.

## Note for round 3 scoring

Fixes 2 and 3 are worth roughly +1 to +2 in their own categories. Fix 1 is the only one that
moves multiple categories at once — a broken coastline and a real ridge would also lift lighting
(new large shadow planes), AO (real occluded valleys), and grade (something to key light against).
Prioritise composition next round even though it is the hardest.
