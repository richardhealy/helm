import { describe, it, expect } from "vitest";
import { optimizeTrip } from "./optimize";

describe.skipIf(!process.env.MAPBOX_TOKEN)("optimizeTrip (live Mapbox)", () => {
  it("returns an ordered trip for a depot + 3 stops", async () => {
    const trip = await optimizeTrip([
      { lat: 51.5, lng: -0.12 }, // depot
      { lat: 51.52, lng: -0.1 },
      { lat: 51.49, lng: -0.14 },
      { lat: 51.51, lng: -0.09 },
    ]);
    expect(trip).not.toBeNull();
    expect(trip!.orderedStopIndices).toHaveLength(3);
    expect(new Set(trip!.orderedStopIndices)).toEqual(new Set([0, 1, 2]));
    expect(trip!.geometry.type).toBe("LineString");
    expect(trip!.legs.length).toBeGreaterThanOrEqual(3);
  });
});
