import { hashString, mulberry32 } from "./rng";
import type { CivSpec, Island } from "./types";

/**
 * Every civilization flies its own color. Not the eight cultural palettes —
 * those are shared by every Roman people in the world — but a banner color
 * unique to each *founded* civilization, rolled at founding and worn by
 * everything its people make: rooftops, clothes, sails, the name on the HUD.
 *
 * Distinctness is guaranteed by construction, not by luck: a new color's hue
 * is placed in the middle of the widest gap between the hues already flying
 * (farthest-point placement on the hue circle), so two civilizations can
 * never land near-identical. Saturation and lightness stay inside a fixed
 * band that reads clearly against sea, sand, and grass.
 */

/** saturation band every civ color lives in — vivid, never neon */
export const CIV_COLOR_SAT: readonly [number, number] = [0.55, 0.68];
/** lightness band — dark enough for white text, light enough for shadowed roofs */
export const CIV_COLOR_LIGHT: readonly [number, number] = [0.44, 0.54];

// ── color math ─────────────────────────────────────────────────────────────

export interface Hsl {
  /** degrees, 0–360 */
  h: number;
  s: number;
  l: number;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r!)}${to(g!)}${to(b!)}`;
}

export function hexToHsl(hex: string): Hsl {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: ((h % 360) + 360) % 360, s, l };
}

/** shortest distance between two hues around the color circle, in degrees */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** the same hue, slid to a new lightness — every derived accent shade comes
 * from here, never from a hardcoded second color */
export function shadeCivColor(hex: string, dl: number, ds = 0): string {
  const { h, s, l } = hexToHsl(hex);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return hslToHex(h, clamp(s + ds), clamp(l + dl));
}

// ── picking a new civilization's color ─────────────────────────────────────

function within(band: readonly [number, number], t: number): number {
  return band[0] + (band[1] - band[0]) * t;
}

/**
 * Roll a banner color for a new civilization, maximally distinct from every
 * color already flying. The first civ gets a truly random hue; every later
 * one lands in the middle of the widest empty arc between existing hues, so
 * with k civilizations the guaranteed pairwise hue gap is ~360/k — the best
 * any assignment can do. Saturation and lightness jitter inside fixed bands.
 */
export function pickCivColor(existing: string[], rand: () => number): string {
  const s = within(CIV_COLOR_SAT, rand());
  const l = within(CIV_COLOR_LIGHT, rand());
  const hues = existing
    .map((hex) => hexToHsl(hex).h)
    .sort((a, b) => a - b);
  if (hues.length === 0) return hslToHex(rand() * 360, s, l);
  // widest gap around the circle; the wrap-around arc counts too
  let bestStart = hues[hues.length - 1]!;
  let bestGap = hues[0]! + 360 - bestStart;
  for (let i = 1; i < hues.length; i++) {
    const gap = hues[i]! - hues[i - 1]!;
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = hues[i - 1]!;
    }
  }
  // dead center of the widest gap, with a whisper of jitter so two worlds
  // never look machine-stamped; jitter is capped far below the safety margin
  const jitter = (rand() - 0.5) * Math.min(10, bestGap * 0.1);
  return hslToHex(bestStart + bestGap / 2 + jitter, s, l);
}

// ── the backfill law ───────────────────────────────────────────────────────

/**
 * Worlds saved before civilizations had colors get them on load: every home
 * island missing a color rolls one, in id order so every boot of the same
 * save deals the same hand. Colonies never own a color — they fly their
 * ruler's, resolved at read time — and wild islands fly nothing at all.
 * Idempotent: an island that already has a color keeps it forever.
 */
export function ensureCivColors(islands: Island[]): void {
  const flying = islands
    .map((i) => i.color)
    .filter((c): c is string => typeof c === "string");
  const homeless = islands
    .filter((i) => (i.origin === "home" || i.kind === "home") && !i.color)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const island of homeless) {
    const rand = mulberry32(hashString(`${island.seed}|civ-color`));
    island.color = pickCivColor(flying, rand);
    flying.push(island.color);
  }
}

// ── wearing the color ──────────────────────────────────────────────────────

const ACCENTED = new Map<string, CivSpec>();

/**
 * A civ spec dressed in one civilization's banner color: rooftops and trim,
 * settlers' clothes, flags and banners (everything drawn from `accent`), and
 * sails dyed a pale shade of the same hue. Walls, hulls, and every cultural
 * shape stay the civilization type's own. Cached per (civ, color) so the
 * renderer's material cache stays bounded.
 */
export function civAccented(spec: CivSpec, color?: string): CivSpec {
  if (!color) return spec;
  const key = `${spec.id}|${color}`;
  let dressed = ACCENTED.get(key);
  if (!dressed) {
    dressed = {
      ...spec,
      accent: color,
      architecture: { ...spec.architecture, trim: color },
      boat: { ...spec.boat, sail: shadeCivColor(color, 0.32, -0.18) },
    };
    ACCENTED.set(key, dressed);
  }
  return dressed;
}
