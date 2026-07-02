import { describe, it, expect } from "vitest";
import { haversine, bearing, pointAlongLine } from "./geo";

describe("haversine", () => {
  it("measures ~111.2 km per degree of latitude", () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("bearing", () => {
  it("is ~90° due east", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 0);
  });
  it("is ~0° due north", () => {
    expect(bearing({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 0);
  });
});

describe("pointAlongLine", () => {
  // A ~111km eastward segment then a ~111km northward segment from (0,0).
  const coords: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];

  it("returns the start at distance 0", () => {
    const p = pointAlongLine(coords, 0);
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.lng).toBeCloseTo(0, 5);
  });

  it("lands partway along the first (eastbound) segment", () => {
    const half = haversine({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 2;
    const p = pointAlongLine(coords, half);
    expect(p.lng).toBeCloseTo(0.5, 1);
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.heading).toBeCloseTo(90, 0);
  });

  it("clamps to the last point when distance exceeds the line", () => {
    const p = pointAlongLine(coords, 10_000_000);
    expect(p.lat).toBeCloseTo(1, 5);
    expect(p.lng).toBeCloseTo(1, 5);
  });
});
