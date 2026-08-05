import { describe, expect, it } from "vitest";
import {
  bandPower,
  bandSpeed,
  CREATION_LIMITS,
  creationCost,
  drawableSprite,
  homeActivity,
  parseCreationInput,
  unitDefense,
} from "./creations";

/** A perfectly legal little ninja — the baseline every bad case mutates. */
function ninja() {
  return {
    name: "Moon Ninjas",
    description: "silent blades of the night",
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
  };
}

describe("the creation design gate", () => {
  it("accepts a legal design and normalizes it", () => {
    const parsed = parseCreationInput(ninja());
    expect(parsed.name).toBe("Moon Ninjas");
    expect(parsed.verbs).toEqual(["raid", "patrol"]);
    expect(parsed.count).toBe(4);
  });

  it("accepts a gatherer that says what it gathers", () => {
    const golem = {
      ...ninja(),
      name: "Stone Golems",
      stats: { power: 5, speed: 1, resilience: 9 },
      verbs: ["gather", "guard"],
      gathers: "stone",
    };
    expect(parseCreationInput(golem).gathers).toBe("stone");
  });

  it("refuses markup, scripts, and links in names", () => {
    for (const name of [
      "<script>alert(1)</script>",
      "a<b>bold</b>",
      "ninja{}", // template braces
      "x`y`",
      "a\\b",
      "see https://evil.example",
      "javascript:alert(1)",
      "onload=hack",
      "www.spam.example",
    ]) {
      expect(() => parseCreationInput({ ...ninja(), name }), name).toThrow();
    }
  });

  it("refuses control characters and injection in descriptions", () => {
    for (const description of [
      "nice" + String.fromCharCode(0) + "try",
      "line" + String.fromCharCode(27) + "escape",
      "two\nlines",
      "<img src=x onerror=alert(1)>",
      "visit http://evil.example now",
    ]) {
      expect(() => parseCreationInput({ ...ninja(), description }), JSON.stringify(description)).toThrow();
    }
    // plain prose stays welcome
    expect(parseCreationInput({ ...ninja(), description: "swift and silent, they strike!" })).toBeTruthy();
  });

  it("caps name and description length", () => {
    expect(() =>
      parseCreationInput({ ...ninja(), name: "N".repeat(CREATION_LIMITS.nameMaxChars + 1) }),
    ).toThrow();
    expect(() =>
      parseCreationInput({
        ...ninja(),
        description: "d".repeat(CREATION_LIMITS.descriptionMaxChars + 1),
      }),
    ).toThrow();
  });

  it("refuses oversized and malformed sprites", () => {
    const big = ninja();
    big.sprite.size = 17;
    big.sprite.pixels = Array.from({ length: 17 }, () => ".".repeat(17));
    expect(() => parseCreationInput(big)).toThrow();

    const ragged = ninja();
    ragged.sprite.pixels[3] = "..00"; // short row
    expect(() => parseCreationInput(ragged)).toThrow();

    const wrongRows = ninja();
    wrongRows.sprite.pixels = wrongRows.sprite.pixels.slice(0, 7);
    expect(() => parseCreationInput(wrongRows)).toThrow();

    const badColor = ninja();
    badColor.sprite.palette = ["red", "#e94560"];
    expect(() => parseCreationInput(badColor)).toThrow();

    const fatPalette = ninja();
    fatPalette.sprite.palette = Array.from({ length: 9 }, () => "#112233");
    expect(() => parseCreationInput(fatPalette)).toThrow();

    const outOfPalette = ninja();
    outOfPalette.sprite.pixels[0] = "..77...."; // palette has 2 colors
    expect(() => parseCreationInput(outOfPalette)).toThrow();
  });

  it("clamps stats: range, and the budget that stops min-max evasion", () => {
    expect(() =>
      parseCreationInput({ ...ninja(), stats: { power: 11, speed: 1, resilience: 1 } }),
    ).toThrow();
    expect(() =>
      parseCreationInput({ ...ninja(), stats: { power: 0, speed: 5, resilience: 5 } }),
    ).toThrow();
    expect(() =>
      parseCreationInput({ ...ninja(), stats: { power: 2.5, speed: 5, resilience: 5 } }),
    ).toThrow();
    // 6+5+5 = 16 > 15: each stat legal alone, the sum is not
    expect(() =>
      parseCreationInput({ ...ninja(), stats: { power: 6, speed: 5, resilience: 5 } }),
    ).toThrow();
  });

  it("keeps the verb list closed, distinct, and consistent", () => {
    expect(() => parseCreationInput({ ...ninja(), verbs: ["explode"] })).toThrow();
    expect(() => parseCreationInput({ ...ninja(), verbs: [] })).toThrow();
    expect(() =>
      parseCreationInput({ ...ninja(), verbs: ["raid", "raid"] }),
    ).toThrow();
    expect(() =>
      parseCreationInput({ ...ninja(), verbs: ["guard", "patrol", "perform", "raid"] }),
    ).toThrow();
    // gather needs a target; a target needs gather
    expect(() => parseCreationInput({ ...ninja(), verbs: ["gather"] })).toThrow();
    expect(() => parseCreationInput({ ...ninja(), gathers: "wood" })).toThrow();
    expect(() => parseCreationInput({ ...ninja(), verbs: ["gather"], gathers: "uranium" })).toThrow();
  });

  it("caps the unit count per order", () => {
    expect(() =>
      parseCreationInput({ ...ninja(), count: CREATION_LIMITS.maxCountPerOrder + 1 }),
    ).toThrow();
    expect(() => parseCreationInput({ ...ninja(), count: 0 })).toThrow();
  });
});

describe("creation arithmetic", () => {
  it("prices units by their stat sum — power is paid for", () => {
    expect(creationCost({ power: 7, speed: 5, resilience: 3 }, 2)).toEqual({
      food: 120,
      wood: 60,
    });
  });

  it("guards defend double; bands strike by power times units", () => {
    const spec = { stats: { power: 4, speed: 2, resilience: 5 }, verbs: ["guard" as const] };
    expect(unitDefense(spec)).toBe(10);
    expect(unitDefense({ ...spec, verbs: ["patrol"] })).toBe(5);
    expect(bandPower(spec, 3)).toBe(12);
    expect(bandSpeed(5)).toBe(8);
  });

  it("home activity is the first non-raid verb", () => {
    expect(homeActivity(["raid", "patrol"])).toBe("patrol");
    expect(homeActivity(["guard"])).toBe("guard");
    expect(homeActivity(["raid"])).toBeNull();
  });
});

describe("drawableSprite — the renderer trusts nothing off the wire", () => {
  it("passes a valid sprite through", () => {
    expect(drawableSprite(ninja().sprite)).not.toBeNull();
  });

  it("rejects everything malformed instead of crashing", () => {
    expect(drawableSprite(null)).toBeNull();
    expect(drawableSprite("sprite")).toBeNull();
    expect(drawableSprite({})).toBeNull();
    expect(drawableSprite({ size: 8, palette: ["#123456"], pixels: ["short"] })).toBeNull();
    expect(
      drawableSprite({
        size: 8,
        palette: ["javascript:x"],
        pixels: Array.from({ length: 8 }, () => "0".repeat(8)),
      }),
    ).toBeNull();
    expect(
      drawableSprite({
        size: 8,
        palette: ["#123456"],
        pixels: Array.from({ length: 8 }, () => "7".repeat(8)),
      }),
    ).toBeNull();
  });
});
