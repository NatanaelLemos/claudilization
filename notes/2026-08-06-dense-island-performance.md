# Dense-island renderer audit — 2026-08-06

The committed `npm run benchmark:dense` fixture models 600 repeated Renaissance
townhouses. Static instrumentation measures 6,600 → 11 main submissions and
4,200 → 7 shadow submissions (99.83% reductions in both) with the same 346,800
submitted triangles. This isolates batching rather than claiming geometry LOD.

The release also refreshes shadows at 4 Hz during camera movement and 1 Hz at
rest, removes small-building shadow batches beyond 180 world units, updates
nearby crowds at 30 Hz and dense crowds at 15 Hz, and selects a stable maximum
of 1,024 visible settlers. Old detailed island crowds stop animating after the
viewer changes focus. Building inspection raycasts one invisible instanced
hitbox set, and replacement batches release instance buffers, geometry, and
unreferenced materials.

Validation: 440 unit tests passed (2 isolated-Postgres contracts skipped), 26
Playwright scenarios passed, typecheck passed, production build passed, and
`npm audit --omit=dev` reported zero vulnerabilities. A fresh hardware-GPU FPS
comparison remains unavailable because the pooled browser exposes no working
WebGL context; the deterministic submission instrumentation is the strongest
valid before/after evidence from this environment. No visibly lossy distant-
building LOD was added.
