import fs from "node:fs";
import { generateIsland } from "/root/clawdia-v4/Storage/projects/claudilization/src/shared/terrain";
import { townPlan, districtFor, INDUSTRY_NODE } from "/root/clawdia-v4/Storage/projects/claudilization/src/shared/townPlan";
import { buildingSpec } from "/root/clawdia-v4/Storage/projects/claudilization/src/shared/buildings";
import { BUILDING_NEED_PROVIDERS } from "/root/clawdia-v4/Storage/projects/claudilization/src/shared/happiness";
import { ageIndex } from "/root/clawdia-v4/Storage/projects/claudilization/src/shared/ages";

type B = { id: string; type: string; stage: string; pos: { x: number; y: number }; age?: string };
type I = { id: string; name: string; kind: string; age: string; seed: number; size: number; buildings: B[]; population: number };

const islands: I[] = JSON.parse(fs.readFileSync("/tmp/islands.json", "utf8"));
const only = process.argv[2];
const needOf = (type: string) =>
  Object.entries(BUILDING_NEED_PROVIDERS).find(([, list]) => (list as readonly string[]).includes(type))?.[0];

const all: any[] = [];
for (const isl of islands) {
  if (only && isl.id !== only) continue;
  const terrain = generateIsland(isl.seed, isl.size);
  const plan = townPlan(terrain, isl.seed);
  const size = terrain.size;
  const belt = size * 0.16;
  const at = (arr: Float32Array, x: number, y: number) => arr[Math.round(y) * size + Math.round(x)] ?? 999;
  const tileAt = (x: number, y: number) => terrain.tiles[Math.round(y) * size + Math.round(x)];
  const nodes = (res: string) => terrain.nodes.filter((n: any) => n.resource === res);

  // town centroid ignoring the two shore outposts, for isolation checks
  const rows = isl.buildings.map((b) => {
    const d = districtFor(b.type);
    const spec = buildingSpec(b.type)!;
    const dPlaza = Math.hypot(b.pos.x - plan.plaza.x, b.pos.y - plan.plaza.y);
    const street = at(plan.streetDist, b.pos.x, b.pos.y);
    const shore = at(plan.shoreDist, b.pos.x, b.pos.y);
    return { isl: isl.id, id: b.id, type: b.type, district: d, spec, age: b.age ?? isl.age,
      x: b.pos.x, y: b.pos.y, tile: tileAt(b.pos.x, b.pos.y)!.kind, dPlaza, street, shore,
      faults: [] as string[], role: "" as string };
  });

  for (const r of rows) {
    const near = rows.filter((o) => o.id !== r.id).map((o) => Math.hypot(o.x - r.x, o.y - r.y)).sort((a, b) => a - b);
    const nearest = near[0] ?? Infinity;
    // ── spatial law (the town plan's own scoring, read as pass/fail) ──
    if (r.tile === "water") r.faults.push("in water");
    if (r.tile === "rock") r.faults.push("on bare rock");
    if (r.district === "harbor" && nearest > 20) r.faults.push(`isolated outpost — nearest building ${nearest.toFixed(0)} tiles away`);
    if (r.district === "defense" && r.shore > 12) r.faults.push(`wall ${r.shore.toFixed(0)} tiles inland — the perimeter law wants ~2.5`);
    if (r.district === "farmland" && r.dPlaza < belt * 0.5) r.faults.push(`farmland ${r.dPlaza.toFixed(0)} from plaza — the belt is ~${belt.toFixed(0)}`);
    if (r.district === "farmland" && r.tile !== "grass") r.faults.push(`farmland on ${r.tile}`);
    const ore = INDUSTRY_NODE[r.type];
    if (ore) {
      const ns = nodes(ore);
      const dn = ns.length ? Math.min(...ns.map((n: any) => Math.hypot(n.pos.x - r.x, n.pos.y - r.y))) : Infinity;
      if (!ns.length) r.faults.push(`no ${ore} anywhere on the island`);
      else if (dn > 12) r.faults.push(`${dn.toFixed(0)} tiles from the nearest ${ore} vein`);
    }
    if ((r.district === "civic" || r.district === "service") && r.dPlaza > 15)
      r.faults.push(`${r.district} building ${r.dPlaza.toFixed(0)} tiles from the plaza it should ring`);
    if (r.street > 6 && r.district !== "harbor") r.faults.push(`off the street skeleton (${r.street >= 999 ? "8+" : r.street.toFixed(1)} tiles)`);
    if (r.dPlaza < plan.plazaRadius && !["civic", "wonder", "service"].includes(r.district))
      r.faults.push("squats the founding plaza");
  }

  // ── functional role (the server's own demand law, read backwards) ──
  const byType = new Map<string, any[]>();
  for (const r of rows) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  const needCovered = new Map<string, any[]>();
  for (const r of rows) {
    const n = needOf(r.type);
    if (n) needCovered.set(n, [...(needCovered.get(n) ?? []), r]);
  }
  for (const r of rows) {
    const s = r.spec;
    if (s.houses) r.role = `houses ${s.houses}`;
    else if (s.foodPerDay) r.role = `+${s.foodPerDay} food/day`;
    else if (s.converts) r.role = `${s.converts.from}→${s.converts.to}`;
    else if (r.type === "dock") r.role = "voyages need it";
    else if (r.type === "fishing-hut") r.role = "shore food";
    else if (needOf(r.type)) {
      const need = needOf(r.type)!;
      const peers = needCovered.get(need)!;
      const first = peers[0]!.id === r.id;
      r.role = first ? `covers the "${need}" need` : `"${need}" already covered by ${peers[0]!.type}`;
      if (!first && !s.joy) r.faults.push(`duplicate service — ${need} is already answered by the ${peers[0]!.type}`);
    } else if (s.joy) r.role = `+${s.joy} joy`;
    else { r.role = "no effect — decoration"; r.faults.push("no mechanical role in the sim"); }
    r.eraGap = ageIndex(isl.age as any) - ageIndex(s.age as any);
  }
  all.push(...rows);

  const bad = rows.filter((r) => r.faults.length);
  console.log(`\n=== ${isl.id} ${isl.name} (${isl.kind}, ${isl.age}, pop ${isl.population}) — ${rows.length} buildings, ${bad.length} flagged ===`);
  console.log(`plaza (${plan.plaza.x},${plan.plaza.y}) r=${plan.plazaRadius}, farm belt ~${belt.toFixed(0)}`);
  for (const r of rows.sort((a, b) => b.faults.length - a.faults.length || a.type.localeCompare(b.type))) {
    const mark = r.faults.length ? "✗" : "✓";
    console.log(`${mark} ${r.type.padEnd(19)} ${r.id.slice(-6)} (${String(r.x).padStart(3)},${String(r.y).padStart(3)}) ${r.district.padEnd(11)} age:${r.spec.age.padEnd(9)} ${r.role.padEnd(34)} ${r.faults.join(" | ")}`);
  }
}
fs.writeFileSync("/tmp/audit-all.json", JSON.stringify(all, null, 1));
