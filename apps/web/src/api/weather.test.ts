/** Weather module tests — pure mapping/formatting only (no network).
 * Network paths are fail-silent by contract and covered by inspection.
 */
import { describe, expect, it } from "vitest";

import {
  dayCacheKey,
  formatDayWeather,
  geoCacheKey,
  wmoGlyph,
  wmoLabel,
} from "./weather";

describe("wmoLabel", () => {
  it("covers the WMO table used by Open-Meteo daily codes", () => {
    expect(wmoLabel(0)).toBe("Clear");
    expect(wmoLabel(2)).toBe("Partly cloudy");
    expect(wmoLabel(3)).toBe("Overcast");
    expect(wmoLabel(45)).toBe("Fog");
    expect(wmoLabel(48)).toBe("Fog");
    expect(wmoLabel(53)).toBe("Drizzle");
    expect(wmoLabel(63)).toBe("Rain");
    expect(wmoLabel(71)).toBe("Snow");
    expect(wmoLabel(80)).toBe("Showers");
    expect(wmoLabel(95)).toBe("Thunderstorm");
    expect(wmoLabel(99)).toBe("Storm with hail");
  });

  it("falls back gracefully on unknown codes", () => {
    expect(wmoLabel(-1)).toBe("—");
    expect(wmoLabel(999)).toBe("—");
    expect(wmoGlyph(999)).toBe("•");
  });
});

describe("formatDayWeather", () => {
  it("renders a compact chip with rain odds when worth mentioning", () => {
    expect(formatDayWeather({ code: 0, tempMax: 21.4, tempMin: 13.6, precipProb: 5 })).toBe("☀ 21°/14°");
    expect(formatDayWeather({ code: 63, tempMax: 12, tempMin: 8, precipProb: 80 })).toContain("80% rain");
  });

  it("hides rain odds below the 30% threshold", () => {
    expect(formatDayWeather({ code: 2, tempMax: 18, tempMin: 10, precipProb: 29 })).not.toContain("rain");
  });

  it("tolerates missing values", () => {
    expect(formatDayWeather({ code: 3, tempMax: null, tempMin: null, precipProb: null })).toBe("☁ –/–");
  });
});

describe("cache keys", () => {
  it("normalizes place names and rounds coords for stable keys", () => {
    expect(geoCacheKey("  Edmonton ")).toBe(geoCacheKey("edmonton"));
    expect(dayCacheKey(53.54441, -113.49091, "2026-09-22")).toBe("weather:day:53.544,-113.491,2026-09-22");
  });
});
