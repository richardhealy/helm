import { describe, it, expect } from "vitest";
import { buildOptimizationUrl, parseOptimization } from "./optimize";

describe("buildOptimizationUrl", () => {
  it("puts the depot first and sets the v1 params", () => {
    const url = buildOptimizationUrl(
      [
        { lat: 51.5, lng: -0.12 },
        { lat: 51.51, lng: -0.13 },
      ],
      "tok",
    );
    expect(url).toContain("/optimized-trips/v1/mapbox/driving/");
    expect(url).toContain("-0.12,51.5;-0.13,51.51");
    expect(url).toContain("source=first");
    expect(url).toContain("roundtrip=true");
    expect(url).toContain("geometries=geojson");
    expect(url).toContain("access_token=tok");
  });
});

describe("parseOptimization", () => {
  // depot (input 0) + two stops (input 1, 2). Optimizer visits stop 2 before stop 1:
  // waypoint_index: depot=0, stop1(input1)=2, stop2(input2)=1
  const json = {
    code: "Ok",
    waypoints: [
      { waypoint_index: 0 },
      { waypoint_index: 2 },
      { waypoint_index: 1 },
    ],
    trips: [
      {
        distance: 3000,
        duration: 600,
        geometry: { type: "LineString", coordinates: [[-0.12, 51.5]] },
        legs: [
          { distance: 1000, duration: 200 },
          { distance: 2000, duration: 400 },
        ],
      },
    ],
  };

  it("orders stops by waypoint_index (visiting order)", () => {
    const trip = parseOptimization(json);
    expect(trip).not.toBeNull();
    // input stop 2 (index 1 in stops array) is visited first
    expect(trip!.orderedStopIndices).toEqual([1, 0]);
    expect(trip!.legs).toHaveLength(2);
    expect(trip!.duration).toBe(600);
  });

  it("returns null on a non-Ok code", () => {
    expect(parseOptimization({ code: "NoRoute" })).toBeNull();
  });
});
