/**
 * The game's rules as DATA — the one reference the server hands out wherever
 * a client (or a player's agent) needs to learn the correct shape of an
 * order: inside `/api/state`, at `GET /api/rules`, and in the body of every
 * orders response that refused something.
 *
 * Everything here is descriptive fact: shapes, limits, costs, laws, and one
 * worked example. Never an instruction, never a URL, never anything phrased
 * at the agent reading it — state is inert, and the tests pin that.
 */
import { CREATION_LIMITS, RESOURCE_IDS } from "./creations";
import { DEFAULT_BALANCE } from "./balance";
import { CATASTROPHE_IDS, catastropheDefinition } from "./catastrophes";
import { ORDER_KINDS } from "./orders";
import { PROTOCOL_VERSION } from "./protocol";

/**
 * A complete, valid create order — the worked example. rules.test.ts proves
 * it passes CreationInputSchema, so the example can never drift from the law.
 */
export const CREATION_EXAMPLE = {
  kind: "create",
  creation: {
    name: "Moonlit Ninjas",
    description: "silent blades sworn to the crescent moon",
    sprite: {
      size: 8,
      palette: ["#1a1a2e", "#e94560"],
      pixels: [
        "..00....",
        ".0110...",
        "..00....",
        ".0000...",
        "0.00.0..",
        "..00....",
        ".0..0...",
        "0....0..",
      ],
    },
    stats: { power: 7, speed: 5, resilience: 3 },
    verbs: ["raid", "patrol"],
    count: 4,
  },
} as const;

/** The full rulebook, serialization-stable. */
export function gameRules() {
  const L = CREATION_LIMITS;
  return {
    protocol: PROTOCOL_VERSION,
    orderKinds: [...ORDER_KINDS],
    orderShapes: {
      assign_gathering: {
        kind: "assign_gathering",
        resource: `one of: ${RESOURCE_IDS.join(", ")}`,
        count: "positive integer — settlers to assign",
      },
      build: { kind: "build", building: "a type from the island state's buildable list" },
      build_boat: { kind: "build_boat" },
      build_plane: { kind: "build_plane" },
      voyage: {
        kind: "voyage",
        dest: "an island id from nearbyIslands",
        intent: "trade | help | colonize | attack",
      },
      advance_age: { kind: "advance_age" },
      create: {
        kind: "create",
        creation: "a creation design — full shape under creations below",
      },
      dispatch: {
        kind: "dispatch",
        creation: "a design's id or exact name",
        dest: "an island id",
        count: "1-24, optional (all home units when omitted)",
      },
      disband: { kind: "disband", creation: "a design's id or exact name" },
      demolish: {
        kind: "demolish",
        building: "a building id, or a type (the first of that type standing)",
        island:
          "optional — your home island by default; otherwise a colony your home rules. " +
          "No refund, no timer; wonders are never torn down",
      },
    },
    creations: {
      summary:
        "an island may invent any unit — ninjas, dragons, golems, siege engines — " +
        "as pure data; the design is validated, priced in resources, simulated, " +
        "and rendered by the game",
      design: {
        name: `1-${L.nameMaxChars} characters: letters, numbers, spaces, and .,'!- only`,
        description: `plain prose, up to ${L.descriptionMaxChars} characters, optional`,
        sprite: {
          size: `integer ${L.spriteMinSize}-${L.spriteMaxSize}`,
          palette: `1-${L.spriteMaxPalette} "#rrggbb" colors`,
          pixels:
            'exactly size rows of exactly size characters each — "." for ' +
            "transparent or a palette index digit",
        },
        stats: {
          power: `integer ${L.statMin}-${L.statMax}`,
          speed: `integer ${L.statMin}-${L.statMax}`,
          resilience: `integer ${L.statMin}-${L.statMax}`,
          budget: `power + speed + resilience <= ${L.statBudget}`,
        },
        verbs: {
          pick: "1-3 distinct verbs; the first non-raid verb is the home activity",
          guard: "defends the island with double resilience",
          patrol: "defends, walks rounds",
          perform: "radiates joy to the settlers",
          gather:
            'harvests a resource tirelessly — requires "gathers": a resource id',
          raid: "the design may be dispatched to attack rival colonies",
        },
        count: `1-${L.maxCountPerOrder} units spawned by one create order`,
      },
      costPerUnit: {
        food: "4 x (power + speed + resilience)",
        wood: "2 x (power + speed + resilience)",
      },
      caps: {
        designsPerIsland: L.maxSpecsPerIsland,
        unitsPerIsland: L.maxUnitsPerIsland,
        unitsPerOrder: L.maxCountPerOrder,
        createsPerIslandDay: L.maxCreatesPerDay,
      },
      dispatchLaw: {
        rivalColony:
          "a raid — the design needs the raid verb; strictly more total power " +
          "than the defense conquers the colony, otherwise the band is lost",
        ownColony: "a garrison",
        homeIslands: "sacred — no creation can ever attack a home island",
      },
      example: CREATION_EXAMPLE,
    },
    catastrophes: {
      cadenceSeconds: DEFAULT_BALANCE.catastropheIntervalSeconds,
      warningSeconds: DEFAULT_BALANCE.catastropheWarningSeconds,
      aftermathSeconds: DEFAULT_BALANCE.catastropheDurationSeconds,
      scope: "one deterministic global event affects every inhabited civilization",
      types: Object.fromEntries(
        CATASTROPHE_IDS.map((id) => {
          const event = catastropheDefinition(id);
          return [
            id,
            {
              label: event.label,
              resourceLossFraction: event.resourceLossFraction,
              nodeDepletionFraction: event.nodeDepletionFraction ?? 0,
              buildingDamageFraction: event.buildingDamageFraction ?? 0,
              buildingScope: event.buildingScope ?? null,
              dockedBoatLossFraction: event.dockedBoatLossFraction ?? 0,
              creationLossFraction: event.creationLossFraction ?? 0,
            },
          ];
        }),
      ),
      invariants: {
        floors: "stocks and node reserves never fall below zero",
        protected:
          "work points, wonders, settlers, ownership, home protection, ages, and daylight never change — what a civilization has learned, no wave can wash away",
        lateJoin: "a civilization joining during aftermath participates at the next event",
      },
    },
  };
}
