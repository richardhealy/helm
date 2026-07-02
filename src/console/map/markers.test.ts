import { describe, it, expect } from "vitest";
import { parsePositionEvent, toGeoJson } from "./markers";

describe("parsePositionEvent", () => {
  it("parses a valid event payload", () => {
    const data = JSON.stringify({ vehicleId: "v1", lat: 51.5, lng: -0.1, heading: 90, speed: 4 });
    expect(parsePositionEvent(data)).toEqual({ vehicleId: "v1", lat: 51.5, lng: -0.1, heading: 90 });
  });

  it("returns null for malformed JSON", () => {
    expect(parsePositionEvent("{not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parsePositionEvent(JSON.stringify({ vehicleId: "v1" }))).toBeNull();
  });
});

describe("toGeoJson", () => {
  it("maps vehicles to point features carrying id and heading", () => {
    const fc = toGeoJson([{ vehicleId: "v1", lat: 51.5, lng: -0.1, heading: 30 }]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features[0].geometry.coordinates).toEqual([-0.1, 51.5]);
    expect(fc.features[0].properties?.heading).toBe(30);
    expect(fc.features[0].properties?.vehicleId).toBe("v1");
  });
});
