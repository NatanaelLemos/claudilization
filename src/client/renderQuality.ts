export type RenderQuality = "high" | "balanced" | "performance";

export interface RenderQualityProfile {
  pixelRatio: number;
  shadowMapSize: 512 | 1024 | 2048;
}

export function renderQualityProfile(
  quality: RenderQuality,
  devicePixelRatio: number,
): RenderQualityProfile {
  const dpr = Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1;
  if (quality === "high") {
    return { pixelRatio: Math.min(2, dpr), shadowMapSize: 2048 };
  }
  if (quality === "balanced") {
    return { pixelRatio: Math.min(1.5, dpr), shadowMapSize: 1024 };
  }
  return { pixelRatio: 1, shadowMapSize: 512 };
}

/**
 * Deliberately asymmetric: sustained slow frames reduce load quickly, while
 * recovery needs a long stable run so quality cannot seesaw during camera
 * moves or while a terrain chunk is being built.
 */
export class AdaptiveRenderQuality {
  private quality: RenderQuality = "high";
  private slowFrames = 0;
  private fastFrames = 0;

  current(): RenderQuality {
    return this.quality;
  }

  sample(frameMs: number): RenderQuality | undefined {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 5_000) return undefined;
    if (frameMs > 24) {
      this.slowFrames += 1;
      this.fastFrames = 0;
    // A healthy 60 Hz browser reports about 16.7 ms between callbacks. Keep
    // enough headroom for timer jitter so a quality step can recover on an
    // ordinary display, not only on 75/120/144 Hz panels.
    } else if (frameMs < 18.5) {
      this.fastFrames += 1;
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    } else {
      this.slowFrames = Math.max(0, this.slowFrames - 1);
      this.fastFrames = 0;
    }

    if (this.slowFrames >= 8 && this.quality !== "performance") {
      this.quality = this.quality === "high" ? "balanced" : "performance";
      this.slowFrames = 0;
      this.fastFrames = 0;
      return this.quality;
    }
    if (this.fastFrames >= 600 && this.quality !== "high") {
      this.quality = this.quality === "performance" ? "balanced" : "high";
      this.slowFrames = 0;
      this.fastFrames = 0;
      return this.quality;
    }
    return undefined;
  }
}

/** Shadows are expensive scene re-renders; movement gets 4 Hz, rest gets 1 Hz. */
export class ShadowRefreshBudget {
  private lastRefreshMs = -Infinity;

  shouldRefresh(nowMs: number, moving: boolean): boolean {
    if (!Number.isFinite(nowMs)) return false;
    const intervalMs = moving ? 250 : 1_000;
    if (nowMs - this.lastRefreshMs < intervalMs) return false;
    this.lastRefreshMs = nowMs;
    return true;
  }

  invalidate(): void {
    this.lastRefreshMs = -Infinity;
  }
}
