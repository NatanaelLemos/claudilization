/**
 * The sky rig: every light, colour and opacity in the scene as a pure function
 * of where the world stands in its day.
 *
 * It lives apart from `scene.ts` on purpose. The renderer needs WebGL, which no
 * test machine here has, so the numbers that decide whether a player can
 * actually *see* their island are computed here, in the open, and pinned by
 * tests — instead of being tuned by eye through one guessed constant.
 *
 * Night is real night: the sun is gone, the stars are out, the palette turns
 * blue and the world is clearly darker than noon. But a player watching their
 * settlers must still be able to read the island, so the night floor is lifted
 * by the moon rather than by washing the colour out — a real moonlit key light
 * with direction, plus enough sky bounce that flat-shaded faces keep their
 * shape.
 */

/** Linear-light rgb in 0..1, matching three.js colour values. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface SkyRig {
  /** 0 at deep night, 1 at high noon — everything else is a lerp of it */
  dayness: number;
  /** the sun's height above the horizon, -1 → 1 */
  elevation: number;
  /** how much the low sun burns the sky orange, 0 → 1 */
  ember: number;
  /** the sun's angle along its arc, for placing the light and the disc */
  angle: number;
  sunIntensity: number;
  sunColor: Rgb;
  /** hemisphere light: sky above, ground bounce below */
  hemiIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  /** the second key light: sea bounce by day, the moon after dark */
  fillIntensity: number;
  fillColor: Rgb;
  skyColor: Rgb;
  oceanColor: Rgb;
  starOpacity: number;
  sunVisible: boolean;
  moonVisible: boolean;
}

export const DAY_PALETTE = {
  sky: hex("#16455c"),
  hemi: hex("#cde6f7"),
  ground: hex("#7a6647"),
  sun: hex("#ffdca8"),
  ocean: hex("#0f4258"),
};

/**
 * Night, brightened. The old palette was a black-blue (#050c17 sky, #42557a
 * bounce) that swallowed buildings whole: with the sun at zero, the only light
 * on a roof was 0.32 of a dim hemisphere. These values keep the hue — deep,
 * cold, unmistakably night — and lift the floor so terrain, walls and settlers
 * still read.
 */
export const NIGHT_PALETTE = {
  sky: hex("#16294a"),
  hemi: hex("#8fa6d4"),
  ground: hex("#3d4a68"),
  sun: hex("#c8d6f2"),
  ocean: hex("#123c55"),
};

export const EMBER = hex("#c96a3a");

/** The moon's own colour — cool, but bright enough to model shapes. */
const MOON = hex("#cfe0ff");
/** By day the fill is a cool bounce off the sea. */
const SEA_BOUNCE = hex("#7fa9c9");

const SUN_PEAK_INTENSITY = 2.6;
/** hemisphere light at deep night ← the single biggest legibility lever */
const HEMI_NIGHT = 0.95;
const HEMI_DAY = 1.42;
/** the moon as a key light: directional, so night keeps its modelling */
const MOON_INTENSITY = 0.85;
const SEA_BOUNCE_INTENSITY = 0.4;

export function hex(value: string): Rgb {
  const n = parseInt(value.replace("#", ""), 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** Rec. 709 luminance — how bright a colour actually looks. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * The whole rig at a fraction of the day, under the world's own daylight share.
 * `dayFraction` is 0 at dawn → 1 at the next dawn; the sun sweeps its half
 * circle across the daylight share and the moon walks the rest.
 */
export function skyRig(dayFraction: number, daylightShare: number): SkyRig {
  const f = ((dayFraction % 1) + 1) % 1;
  const share = Math.min(0.999, Math.max(0.001, daylightShare));
  const angle =
    f < share ? (f / share) * Math.PI : Math.PI + ((f - share) / (1 - share)) * Math.PI;
  const elevation = Math.sin(angle);
  // wide windows: dawn and dusk take their time instead of switching
  const dayness = smooth((elevation + 0.18) / 0.5);
  const ember = Math.max(0, 1 - Math.abs(elevation) * 1.8);
  const moonHeight = Math.sin(angle + Math.PI);

  return {
    dayness,
    elevation,
    ember,
    angle,
    sunIntensity: SUN_PEAK_INTENSITY * dayness,
    sunColor: mix(DAY_PALETTE.sun, EMBER, ember * 0.8),
    hemiIntensity: HEMI_NIGHT + (HEMI_DAY - HEMI_NIGHT) * dayness,
    hemiSky: mix(NIGHT_PALETTE.hemi, DAY_PALETTE.hemi, dayness),
    hemiGround: mix(NIGHT_PALETTE.ground, DAY_PALETTE.ground, dayness),
    // the fill is the sea's bounce by day and the moon after dark; the moon is
    // the stronger of the two, because it is the only key light night has
    fillIntensity: SEA_BOUNCE_INTENSITY * dayness + MOON_INTENSITY * (1 - dayness),
    fillColor: mix(MOON, SEA_BOUNCE, dayness),
    skyColor: mix(mix(NIGHT_PALETTE.sky, DAY_PALETTE.sky, dayness), EMBER, ember * 0.45),
    oceanColor: mix(NIGHT_PALETTE.ocean, DAY_PALETTE.ocean, dayness),
    // stars still come out — night must still read as night
    starOpacity: (1 - dayness) * 0.75,
    sunVisible: elevation > -0.12,
    moonVisible: moonHeight > -0.05,
  };
}

/**
 * What a surface actually receives, in luminance: the hemisphere's average
 * bounce plus both key lights. This is the number a player sees as "can I make
 * out my island", so it is what the tests pin.
 */
export function litLuminance(rig: SkyRig): number {
  const ambient =
    rig.hemiIntensity * luminance(mix(rig.hemiGround, rig.hemiSky, 0.5));
  const moonOrSea = rig.fillIntensity * luminance(rig.fillColor) * 0.7;
  const key = rig.sunIntensity * luminance(rig.sunColor) * 0.7;
  return ambient + moonOrSea + key;
}
