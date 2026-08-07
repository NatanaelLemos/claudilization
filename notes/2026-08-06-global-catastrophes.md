# Global catastrophes

Implemented on 2026-08-06 as an authoritative world law.

## Cadence and synchronization

- The first event is scheduled 1,800 world seconds after a new world's birth;
  one event then occurs on each 1,800-second boundary.
- A pre-feature world records one `catastrophes` activation command at upgrade
  time and starts its first interval there. Command-log replay remains inert
  before that epoch, so the new law cannot rewrite historical simulation.
- The schedule is driven only by `World.advanceToWallClock()` and is serialized
  with snapshots. Browser timers never choose or trigger an event.
- Every client receives `catastrophe` on every canonical world frame: `nextAt`,
  the 300-second warning threshold, and any active event/result.
- The server emits one global warning five minutes before impact, one global
  start event, per-island result events, and one global end event after a
  45-second synchronized aftermath.
- A long outage causes one event when the world wakes and skips other missed
  slots; it never replays an avalanche. The next event stays on the original
  cadence's first future boundary.
- Selection is deterministic from world seed, event sequence, and scheduled
  time. The immediately previous type is removed from the candidate set.

## Balance catalog

All values live in `src/shared/catastrophes.ts`.

| Event | Stocks lost | Work lost | Distinct damage |
| --- | ---: | ---: | --- |
| Earthquake | 12% | 8% | 35% of completed non-wonder structures require repair from 45% progress |
| Volcanic eruption | 16% | 10% | 12% of remaining map resource reserves are buried; 25% of productive buildings require repair from 35% |
| Tsunami | 18% | 12% | all completed docks/fishing huts require repair from 30%; 35% of docked non-air vessels are destroyed (rounded up) |
| Godzilla attack | 25% | 20% | the nearest 50% of non-wonder structures along a deterministic island path require repair from 15%; 20% of creation armies are lost (rounded down) |

Every stocked resource is reduced by the event percentage. Values are clamped
at zero; no inventory, work, or resource node can become negative. Structural
damage reopens construction rather than deleting the structure or charging its
original cost, so autonomous repair remains possible.

## Protected invariants and edge cases

- Wonders, settlers, island provenance/ownership, home protection, ages, and
  world/daylight clocks are never changed by catastrophes.
- Every inhabited home or colony is charged, including dormant civilizations.
  Wild islands participate in map-reserve effects but have no treasury to tax.
- A player joining during an active aftermath sees the canonical event but is
  not charged retroactively; that civilization participates at the next slot.
- An empty world still advances the sequence and broadcasts the event.
- Node's synchronous world mutation makes a catastrophe atomic with respect to
  ticks, pulses, and orders. A pre-event snapshot deterministically replays the
  event; a post-event snapshot records its advanced sequence and cannot apply
  it twice.

## 2026-08-07 physical-effects update

- Cadence is now exactly 3,600 seconds. New snapshots stamp the cadence; an
  unstamped 30-minute snapshot rebases once to one hour after upgrade, then
  preserves that boundary across later restarts.
- Earthquakes apply a strong, rapidly settling render-only camera shake. The
  camera transform is restored after every draw so controls cannot drift, and
  `prefers-reduced-motion` suppresses shake entirely.
- Tsunamis mount one procedural four-renderable wave (wall, crest, wash, and
  spray) that rises from the water, crosses the watched island, and recedes.
- Godzilla uses original procedural low-poly geometry: a giant kaiju enters
  from the sea, follows a synchronized rampage path with stomps and debris,
  then submerges. No third-party art or texture is used.
- Every animation derives progress from authoritative `startedAt`/`endsAt`
  world time, including late joins. One permanent frame callback owns the
  lifecycle; transient geometry/materials and camera offsets are disposed at
  event end or replacement.

Verification: 445 unit tests, 26 browser scenarios, TypeScript, production
build, Knip analysis, the 600-building performance benchmark, and production
dependency audit passed. The project has no ESLint dependency/configuration,
so no repository-defined ESLint target exists.
