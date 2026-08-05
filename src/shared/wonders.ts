import { AGES, ageIndex } from "./ages";
import { CIV_IDS } from "./types";
import type { Age, BuildingSpec, CivId, ResourceId } from "./types";

/**
 * Wonders: one monument per [civilization × age]. Vast cost — thousands of
 * that age's resources — and vast pride: a completed wonder lifts the whole
 * island's happiness like nothing else, and the world hears of it.
 */

const NAMES: Record<CivId, Record<Age, string>> = {
  roman: {
    stone: "saturn-stones",
    bronze: "bronze-she-wolf",
    iron: "gate-of-mars",
    classical: "colosseum",
    medieval: "aurelian-walls",
    renaissance: "grand-basilica",
    industrial: "imperial-terminus",
    modern: "via-aeterna",
    future: "nova-roma-spire",
  },
  greek: {
    stone: "cyclopean-gate",
    bronze: "lion-of-mycenae",
    iron: "oracle-of-delphi",
    classical: "parthenon",
    medieval: "monastery-of-meteora",
    renaissance: "academy-of-athens",
    industrial: "corinthian-canal",
    modern: "olympic-colossus",
    future: "olympus-ring",
  },
  egyptian: {
    stone: "circle-of-heliopolis",
    bronze: "great-pyramid",
    iron: "great-sphinx",
    classical: "temple-of-karnak",
    medieval: "lighthouse-of-alexandria",
    renaissance: "hall-of-scribes",
    industrial: "suez-gateway",
    modern: "aswan-colossus",
    future: "eye-of-horus-array",
  },
  norse: {
    stone: "jotun-runestones",
    bronze: "sun-chariot-hall",
    iron: "great-mead-hall",
    classical: "yggdrasil-shrine",
    medieval: "dragon-fleet-hall",
    renaissance: "althing-dome",
    industrial: "great-northern-span",
    modern: "aurora-tower",
    future: "bifrost-bridge",
  },
  japanese: {
    stone: "dogu-circle",
    bronze: "great-torii",
    iron: "izumo-shrine",
    classical: "golden-pavilion",
    medieval: "white-heron-castle",
    renaissance: "great-buddha-of-nara",
    industrial: "meiji-grand-station",
    modern: "rising-sun-tower",
    future: "celestial-garden",
  },
  aztec: {
    stone: "olmec-heads",
    bronze: "pyramid-of-the-sun",
    iron: "temple-of-quetzalcoatl",
    classical: "great-templo-mayor",
    medieval: "floating-gardens",
    renaissance: "calendar-stone-hall",
    industrial: "gran-causeway",
    modern: "condor-stadium",
    future: "fifth-sun-engine",
  },
  mauryan: {
    stone: "ancestor-stupa",
    bronze: "pillar-of-ashoka",
    iron: "iron-pillar-of-delhi",
    classical: "great-stupa-of-sanchi",
    medieval: "temple-of-a-thousand-pillars",
    renaissance: "taj-mahal",
    industrial: "grand-trunk-terminus",
    modern: "lotus-temple",
    future: "indra-net-array",
  },
  mongol: {
    stone: "deer-stones",
    bronze: "great-ovoo",
    iron: "khans-golden-ger",
    classical: "karakorum-palace",
    medieval: "silver-tree-of-karakorum",
    renaissance: "erdene-zuu-monastery",
    industrial: "steppe-iron-road",
    modern: "eternal-sky-tower",
    future: "tengri-orbital",
  },
};

/** every wonder of an age costs the same — the name and the pride differ */
const COSTS: Record<Age, Partial<Record<ResourceId, number>>> = {
  stone: { wood: 1200, stone: 1800 },
  bronze: { wood: 1500, stone: 1200, copper: 600, tin: 300 },
  iron: { stone: 1800, wood: 1000, iron: 800 },
  classical: { marble: 1500, stone: 1200, gold: 500 },
  medieval: { stone: 2500, wood: 1200, iron: 500 },
  renaissance: { marble: 1500, gold: 800, coal: 500, wood: 800 },
  industrial: { steel: 1500, iron: 1000, coal: 800 },
  modern: { steel: 2000, gold: 600, oil: 600 },
  future: { steel: 1500, antimatter: 200, plutonium: 300, gems: 500 },
};

const WONDER_JOY = 30;

export const WONDERS: BuildingSpec[] = CIV_IDS.flatMap((civ) =>
  AGES.map((age) => ({
    type: NAMES[civ][age],
    age,
    cost: COSTS[age],
    buildSeconds: 300 + 120 * ageIndex(age),
    joy: WONDER_JOY,
    wonder: true,
  })),
);

/** which people a wonder belongs to — only they may raise it */
export const WONDER_CIV = new Map<string, CivId>(
  CIV_IDS.flatMap((civ) => AGES.map((age): [string, CivId] => [NAMES[civ][age], civ])),
);

export function wonderFor(civ: CivId, age: Age): BuildingSpec {
  return WONDERS.find((w) => w.type === NAMES[civ][age])!;
}
