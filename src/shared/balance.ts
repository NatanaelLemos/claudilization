export interface Balance {
  /** real seconds per simulation tick */
  tickSeconds: number;
  /** real seconds per in-game day — one real hour, so dawn is every :00 */
  daySeconds: number;
  /** fraction of the day the sun is up — the rest is night, and the town
   * sleeps: no gathering, no building until dawn */
  daylightShare: number;
  /** hours without a pulse before an island sleeps */
  dormancyHours: number;
  /** consecutive food-less in-game days before a settler dies */
  starvationDays: number;
  /** in-game days for a child to become an adult */
  childGrowsDays: number;
  /** chance per in-game day that an eligible house produces a child */
  birthChancePerDay: number;
  foodPerSettlerPerDay: number;
  /** food a new island lands with, in days of full-population meals */
  starterFoodDays: number;
  /** world units within which an island "sees" its neighbours */
  nearbyRadius: number;
  /** spacing of the golden-angle island spiral */
  islandSpacing: number;
  /** island grid size (tiles per side) */
  islandSize: number;
  inspirationWindowSeconds: number;
  /** minimum visible events per pulse — the floor that never breaks */
  inspirationFloor: number;
  /** tokens/day of the reference steady daily player (pace anchor) */
  referenceDailyTokens: number;
  workPointsPerToken: number;
  /** stone→bronze work-point requirement; each later age is ×ageCostMultiplier */
  bronzeWorkPoints: number;
  ageCostMultiplier: number;
  /** must stay ≤ 300 to honour the ≤5-minute-loss durability rule */
  snapshotIntervalSeconds: number;
  recapAwaySeconds: number;
  boatSpeed: number;
  /** planes cross the same ocean much faster than sails */
  planeSpeed: number;
  /** seconds between chances for an empty island to rise; 0 disables.
   * A new empty island rises only when no empty island waits on the map —
   * one vacancy at a time, however many civilizations are playing. */
  wildSpawnIntervalSeconds: number;
  /** settlers a colonizing voyage carries */
  colonyCrew: number;
  /** raiders an attacking voyage carries */
  raidCrew: number;
  /** world-seconds before the same attacker→defender pair rings the bell again */
  attackAlertCooldownSeconds: number;
  /** base real/world seconds between global catastrophes — each strike rolls
   * its follow-up gap as 1×, 5×, or 24× this base (see selectCatastropheGap) */
  catastropheIntervalSeconds: number;
  /** countdown threshold announced to every connected viewer */
  catastropheWarningSeconds: number;
  /** how long the synchronized aftermath state remains active */
  catastropheDurationSeconds: number;
  /** share of a node's capacity that regrows each dawn — forests, shoals,
   * herds. The land breathes back; only the pace is law. */
  nodeRegenOrganicShare: number;
  /** share of a mineral node's capacity that seeps back each dawn — the
   * earth's slow gift, so no age ever inherits a world already spent */
  nodeRegenMineralShare: number;
}

export const DEFAULT_BALANCE: Balance = {
  tickSeconds: 1,
  // one real hour is one island day, split 50 minutes of sun and 10 of night.
  // Written as the seconds themselves so the split is readable and exact:
  // night begins the instant the day's 3000th second lands.
  daySeconds: 3600,
  daylightShare: 3000 / 3600,
  dormancyHours: 24,
  starvationDays: 3,
  childGrowsDays: 5,
  birthChancePerDay: 0.3,
  foodPerSettlerPerDay: 1,
  starterFoodDays: 3,
  nearbyRadius: 500,
  islandSpacing: 260,
  // 96 × sqrt(3) = 166.28: the live world's islands were grown to three times
  // their former area, so new ones are born at that same scale.
  islandSize: 166,
  inspirationWindowSeconds: 3600,
  inspirationFloor: 1,
  referenceDailyTokens: 200_000,
  workPointsPerToken: 0.001,
  bronzeWorkPoints: 900,
  ageCostMultiplier: 2,
  snapshotIntervalSeconds: 120,
  recapAwaySeconds: 1800,
  boatSpeed: 8,
  planeSpeed: 40,
  wildSpawnIntervalSeconds: 7200,
  colonyCrew: 3,
  raidCrew: 4,
  // a flotilla launched together rings once; a renewed assault two minutes
  // later is news again
  attackAlertCooldownSeconds: 120,
  // the base gap is one real hour, with a five-minute warning; each strike
  // rolls the NEXT gap as one, five, or twenty-four base intervals — the
  // world keeps no schedule. Effects land once at the start; the aftermath
  // is presentation/sync state.
  catastropheIntervalSeconds: 60 * 60,
  catastropheWarningSeconds: 5 * 60,
  catastropheDurationSeconds: 45,
  // a wood node (500 cap) is whole again in ~13 island days; an ore vein in
  // ~50. Faster than the volcano takes, slower than a settler gathers.
  nodeRegenOrganicShare: 0.08,
  nodeRegenMineralShare: 0.02,
};
