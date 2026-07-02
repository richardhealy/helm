import { describe, it, expect } from "vitest";
import { stopsToGeoJson } from "./stops";

describe("stopsToGeoJson", () => {
  it("maps stops to point features carrying id and status", () => {
    const fc = stopsToGeoJson([
      { id: "s1", lat: 51.5, lng: -0.1, status: "en_route" },
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([-0.1, 51.5]);
    expect(fc.features[0].properties?.status).toBe("en_route");
    expect(fc.features[0].properties?.id).toBe("s1");
  });
});
