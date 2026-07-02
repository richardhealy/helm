import { describe, it, expect } from "vitest";
import { routesToGeoJson } from "./routes";

describe("routesToGeoJson", () => {
  it("wraps route geometries as line features keyed by vehicle", () => {
    const fc = routesToGeoJson([
      {
        vehicleId: "v1",
        geometry: { type: "LineString", coordinates: [[-0.12, 51.5], [-0.1, 51.52]] },
      },
    ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry.type).toBe("LineString");
    expect(fc.features[0].properties?.vehicleId).toBe("v1");
  });
});
