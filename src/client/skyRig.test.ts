import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "../shared/balance";
import { litLuminance, luminance, skyRig } from "./skyRig";

/**
 * Night has to be legible.
 *
 * The old night put the sun at zero and left a 0.32 hemisphere over a near-black
 * palette: the island simply disappeared for ten minutes of every hour. These
 * tests hold the two ends of that trade — a night a player can actually watch,
 * that still unmistakably reads as night.
 */

const SHARE = DEFAULT_BALANCE.daylightShare;
const NOON = SHARE / 2;
const MIDNIGHT = SHARE + (1 - SHARE) / 2;

describe("the night is dark, not blind", () => {
  it("keeps enough light on the island to see it by", () => {
    const night = skyRig(MIDNIGHT, SHARE);
    expect(night.dayness).toBe(0); // the sun is well and truly down
    expect(night.sunIntensity).toBe(0);
    // what a surface actually receives: hemisphere bounce plus the moon
    expect(litLuminance(night)).toBeGreaterThan(0.8);
    // the moon is a real key light, not a rounding error, and it is the only
    // thing giving shapes their modelling after dark
    expect(night.fillIntensity).toBeGreaterThan(0.7);
    // nothing on screen is allowed to be pure black — the sea and sky still
    // carry colour, so silhouettes read against them
    expect(luminance(night.skyColor)).toBeGreaterThan(0.08);
    expect(luminance(night.oceanColor)).toBeGreaterThan(0.08);
    expect(luminance(night.hemiGround)).toBeGreaterThan(0.15);
  });

  it("still reads as night — the day is far brighter, and the stars are out", () => {
    const night = skyRig(MIDNIGHT, SHARE);
    const noon = skyRig(NOON, SHARE);
    expect(noon.dayness).toBeCloseTo(1);
    const ratio = litLuminance(night) / litLuminance(noon);
    expect(ratio).toBeGreaterThan(0.15); // visible
    expect(ratio).toBeLessThan(0.45); // but plainly night
    expect(luminance(night.skyColor)).toBeLessThan(luminance(noon.skyColor) * 0.75);
    expect(night.starOpacity).toBeGreaterThan(0.5);
    expect(noon.starOpacity).toBe(0);
    expect(night.moonVisible).toBe(true);
    expect(night.sunVisible).toBe(false);
  });

  it("brightens without flattening: the light still has a direction", () => {
    const night = skyRig(MIDNIGHT, SHARE);
    // the moon's own contribution is a meaningful share of the total, so faces
    // turned away from it stay darker than faces turned toward it
    const directional = night.fillIntensity * luminance(night.fillColor) * 0.7;
    expect(directional / litLuminance(night)).toBeGreaterThan(0.25);
  });

  it("turns on the world's own share of daylight, not a compiled-in one", () => {
    // a 50:10 day: the sun is up at :25 past and down at :55 past
    expect(skyRig(25 / 60, SHARE).sunIntensity).toBeGreaterThan(0);
    expect(skyRig(55 / 60, SHARE).sunIntensity).toBe(0);
    // hand the rig a different world law and the arc follows it
    const evenSplit = 0.5;
    expect(skyRig(0.25, evenSplit).elevation).toBeCloseTo(1);
    expect(skyRig(0.75, evenSplit).elevation).toBeCloseTo(-1);
    expect(skyRig(0.75, SHARE).elevation).toBeGreaterThan(0); // still afternoon
  });

  it("crosses dawn and dusk gradually — no light switch", () => {
    const samples = [];
    for (let f = 0.79; f <= 0.88; f += 0.005) samples.push(skyRig(f, SHARE).dayness);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
      expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeLessThan(0.35);
    }
    expect(samples[0]!).toBeGreaterThan(0.3);
    expect(samples[samples.length - 1]!).toBe(0);
  });
});
