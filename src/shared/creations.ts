/**
 * Player-invented creations — the "create whatever you want" layer.
 *
 * A creation is DATA, never code: a name, a pixel-art sprite, clamped stats,
 * and behaviors picked from a closed verb list. The player's own Claude
 * composes the definition; this module is the single gate every definition
 * passes through — schema, sanitization, and budget clamping — on the MCP
 * client, the API boundary, and durable-log replay alike. The server's
 * deterministic simulation interprets the verbs; nothing user-supplied is
 * ever executed.
 */
import { z } from "zod";
import type {
  CreationInput,
  CreationSpec,
  CreationStats,
  CreationVerb,
  ResourceId,
} from "./types";

export const RESOURCE_IDS: [ResourceId, ...ResourceId[]] = [
  "food", "wood", "stone", "copper", "tin", "iron", "steel", "marble",
  "gold", "silver", "preciousMetals", "gems", "coal", "oil", "gas",
  "plutonium", "antimatter",
];

export const CREATION_VERBS = ["guard", "patrol", "perform", "gather", "raid"] as const;

export const CREATION_LIMITS = {
  /** distinct creation designs an island may keep */
  maxSpecsPerIsland: 8,
  /** living units an island's roster may hold — at home plus at sea */
  maxUnitsPerIsland: 24,
  /** units one `create` order may spawn */
  maxCountPerOrder: 6,
  /** successful `create` orders per island per in-game day */
  maxCreatesPerDay: 5,
  statMin: 1,
  statMax: 10,
  /** power + speed + resilience may not exceed this */
  statBudget: 15,
  spriteMinSize: 8,
  spriteMaxSize: 16,
  spriteMaxPalette: 8,
  nameMaxChars: 24,
  descriptionMaxChars: 140,
} as const;

/** guards defend with double their resilience; everyone else defends with it once */
export const GUARD_DEFENSE_MULTIPLIER = 2;

/** resource units per second a gathering creation collects, per point of power */
export const CREATION_GATHER_RATE_PER_POWER = 0.05;

/** happiness a performing creation radiates (joins the leisure pool, capped) */
export const PERFORM_JOY = 2;

/**
 * What a creation costs, per unit: stat points are paid for in food and wood,
 * so power is earned by the economy — never free through prompt engineering.
 */
export function creationCost(
  stats: CreationStats,
  count: number,
): Partial<Record<ResourceId, number>> {
  const sum = stats.power + stats.speed + stats.resilience;
  return { food: 4 * sum * count, wood: 2 * sum * count };
}

/** World units per second a dispatched band travels — the slowest member sets the pace. */
export function bandSpeed(slowestSpeedStat: number): number {
  return 4 + 0.8 * slowestSpeedStat;
}

/** What one unit adds to a defending island's strength. */
export function unitDefense(spec: Pick<CreationSpec, "stats" | "verbs">): number {
  const mult = spec.verbs.includes("guard") ? GUARD_DEFENSE_MULTIPLIER : 1;
  return spec.stats.resilience * mult;
}

/** A raiding band's striking strength — power, unit by unit. No dice. */
export function bandPower(spec: Pick<CreationSpec, "stats">, units: number): number {
  return spec.stats.power * units;
}

/**
 * Anything that could smuggle markup, scripts, links, or control characters
 * into a rendered name or event line. Creations are drawn for every spectator
 * on a public server, so string fields carry prose only. Written with escaped
 * ranges — raw control bytes in source once crashed tooling downstream.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT =
  /[<>{}`\\\u0000-\u001f\u007f]|:\/\/|javascript:|vbscript:|data:|on\w+\s*=|www\./i;

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'!-]{0,23}$/u;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const StatSchema = z
  .number()
  .int()
  .min(CREATION_LIMITS.statMin)
  .max(CREATION_LIMITS.statMax);

export const CreationInputSchema = z
  .object({
    name: z.string().trim().min(1).max(CREATION_LIMITS.nameMaxChars),
    description: z
      .string()
      .trim()
      .max(CREATION_LIMITS.descriptionMaxChars)
      .optional()
      .default(""),
    sprite: z.object({
      size: z
        .number()
        .int()
        .min(CREATION_LIMITS.spriteMinSize)
        .max(CREATION_LIMITS.spriteMaxSize),
      palette: z
        .array(z.string().regex(HEX_COLOR_RE, "palette colors are #rrggbb"))
        .min(1)
        .max(CREATION_LIMITS.spriteMaxPalette),
      pixels: z
        .array(z.string().max(CREATION_LIMITS.spriteMaxSize))
        .min(CREATION_LIMITS.spriteMinSize)
        .max(CREATION_LIMITS.spriteMaxSize),
    }),
    stats: z.object({
      power: StatSchema,
      speed: StatSchema,
      resilience: StatSchema,
    }),
    verbs: z.array(z.enum(CREATION_VERBS)).min(1).max(3),
    gathers: z.enum(RESOURCE_IDS).optional(),
    count: z.number().int().min(1).max(CREATION_LIMITS.maxCountPerOrder),
  })
  .superRefine((c, ctx) => {
    if (!NAME_RE.test(c.name) || UNSAFE_TEXT.test(c.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message:
          "names are letters, numbers, spaces, and .,'!- only — no markup or links",
      });
    }
    if (UNSAFE_TEXT.test(c.description ?? "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "descriptions are plain prose — no markup, links, or scripts",
      });
    }
    if (c.sprite.pixels.length !== c.sprite.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sprite", "pixels"],
        message: `the sprite is ${c.sprite.size}×${c.sprite.size} — exactly ${c.sprite.size} rows`,
      });
    }
    const rowRe = new RegExp(`^[.0-7]{${c.sprite.size}}$`);
    c.sprite.pixels.forEach((row, i) => {
      if (!rowRe.test(row)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sprite", "pixels", i],
          message: `row ${i} must be ${c.sprite.size} characters of "." or palette digits`,
        });
        return;
      }
      for (const ch of row) {
        if (ch !== "." && Number(ch) >= c.sprite.palette.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sprite", "pixels", i],
            message: `row ${i} uses palette index ${ch} but the palette has ${c.sprite.palette.length} colors`,
          });
          return;
        }
      }
    });
    const sum = c.stats.power + c.stats.speed + c.stats.resilience;
    if (sum > CREATION_LIMITS.statBudget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stats"],
        message: `stat budget exceeded: power+speed+resilience is ${sum}, the cap is ${CREATION_LIMITS.statBudget}`,
      });
    }
    if (new Set(c.verbs).size !== c.verbs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verbs"],
        message: "verbs must be distinct",
      });
    }
    if (c.verbs.includes("gather") && !c.gathers) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gathers"],
        message: 'a gathering creation must say what it gathers (e.g. "wood")',
      });
    }
    if (c.gathers && !c.verbs.includes("gather")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verbs"],
        message: 'a creation that gathers needs the "gather" verb',
      });
    }
  });

/** Validate one untrusted creation definition. Throws with informative issues. */
export function parseCreationInput(input: unknown): CreationInput {
  return CreationInputSchema.parse(input) as CreationInput;
}

/**
 * The one standing activity a unit performs at home, from its verbs in the
 * player's chosen order — raid is dispatch-only and never a home activity.
 */
export function homeActivity(verbs: CreationVerb[]): Exclude<CreationVerb, "raid"> | null {
  for (const v of verbs) if (v !== "raid") return v;
  return null;
}

/**
 * Renderer-side re-check: sprites arrive over the wire from a public server,
 * so the client trusts nothing. Returns the rows if the sprite is drawable,
 * null if anything is off — callers fall back to a placeholder, never crash.
 */
export function drawableSprite(
  sprite: unknown,
): { size: number; palette: string[]; pixels: string[] } | null {
  if (!sprite || typeof sprite !== "object") return null;
  const s = sprite as { size?: unknown; palette?: unknown; pixels?: unknown };
  const size = s.size;
  if (
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < CREATION_LIMITS.spriteMinSize ||
    size > CREATION_LIMITS.spriteMaxSize
  )
    return null;
  if (!Array.isArray(s.palette) || s.palette.length < 1 || s.palette.length > CREATION_LIMITS.spriteMaxPalette)
    return null;
  if (!s.palette.every((c) => typeof c === "string" && HEX_COLOR_RE.test(c))) return null;
  if (!Array.isArray(s.pixels) || s.pixels.length !== size) return null;
  const rowRe = new RegExp(`^[.0-${s.palette.length - 1}]{${size}}$`);
  if (!s.pixels.every((row) => typeof row === "string" && rowRe.test(row))) return null;
  return { size, palette: s.palette as string[], pixels: s.pixels as string[] };
}
