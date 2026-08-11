# Living towns and atmosphere — 2026-08-11

This pass makes a civilization read as a town built for reasons, then gives
that town a coherent miniature-world atmosphere without changing saved entity
shapes or the simulation's deterministic replay contract.

## Town anatomy and gameplay rationale

- A terrain-and-seed town plan gives every island a founding plaza, six
  slope-aware avenues, a ring road, and functional districts. New housing
  follows streets; farms occupy a flatter outer belt; stores serve farms;
  industry seeks its resource; civic and service buildings frame the centre;
  defenses watch the coast; wonders take commanding ground.
- Server placement remains deterministic and save-compatible: the plan is a
  pure function of the existing terrain seed/size, facings are derived rather
  than persisted, and serialize/deserialize remains byte-identical.
- Buildings face their plaza, street, or sea. Door-to-door footpaths reinforce
  the same plan, work yards stay beside the right entrances, and slope-perched
  structures receive small instanced foundations rather than floating or
  sinking.

## Atmosphere, physics, materials, and camera

- Warm, thinned mineral outcrops remove the former grey boulder mass while
  leaving every simulation resource node intact. Settlers and doors now share
  a believable scale.
- Windows glow after dusk; bounded instanced smoke and civic pennants add town
  life only to the focused/nearby island. Clouds drift on the world clock and
  freeze under reduced motion.
- Ships and ambient craft use the CPU twin of the water shader's swell for
  height, pitch, and roll. The opening curtain now reveals actual land through
  a composed establishing camera instead of exposing an empty ocean frame.
- Mobile uses fewer clouds and its established prop-density reduction;
  reduced-motion disables the camera animation, cloud drift, flags, and smoke
  drift. Off-screen islands retain lightweight building silhouettes and gain
  town streets/effects only when focused.

## Validation and performance

- New/affected tests: 39 assertions passing across town planning, opening view,
  town effects, grounds lifecycle, water, terrain visuals, structures, and
  building batches.
- Full Vitest: 501 passed, 2 Postgres-only skipped. TypeScript and production
  Vite build pass. Targeted ESLint has no errors or warnings in changed files;
  `npm audit --omit=dev` reports zero vulnerabilities.
- Knip completes with the repository's existing executable/dead-export
  inventory; it reports none of this pass's new modules or lifecycle exports.
- Browser scenarios: 27/28 in the shared 9.9-minute run; scenario 21's known
  terrain-drain timing case passed. Scenario 20 measured 0.226 phase drift
  against a <0.2 threshold under the accelerated six-second day, then passed
  alone in 26.9 seconds. Unit laws prove island detail cannot update the sky.
- Dense 600-building fixture: 11 main and 7 shadow submissions, both 99.83%
  below unbatched rendering. Always-visible nature/resources fall to 18 draws;
  enhanced paths/yards remain distance-culled and add zero map-range draws.

## Evidence

- Final day: `notes/evidence/2026-08-11-wow-final-day-desktop.png` and
  `notes/evidence/2026-08-11-wow-final-day-mobile.png`.
- Final night: `notes/evidence/2026-08-11-wow-final-night-desktop.png` and
  `notes/evidence/2026-08-11-wow-final-night-mobile.png`.
- The earlier `town-after-local` captures intentionally retain the discovered
  boulder-mass artifact; the four `wow-final` captures prove its removal.

## Honest limitations

- The town plan affects future building sites; existing saved buildings are
  not relocated, only faced and grounded coherently.
- Craft sample open-water swell amplitude; near-shore shader calming is not
  mirrored through a CPU bathymetry lookup.
- Smoke and pennants are restrained instanced accents, not particle/fluid or
  cloth simulation. The six-second scenario clock can expose timing noise that
  is negligible against the production day length.
