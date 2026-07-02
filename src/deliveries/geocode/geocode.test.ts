import { describe, it, expect } from "vitest";
import { buildGeocodeUrl, parseGeocode } from "./geocode";

describe("buildGeocodeUrl", () => {
  it("encodes the address and includes the token and limit", () => {
    const url = buildGeocodeUrl("10 Downing St, London", "tok123");
    expect(url).toContain("/search/geocode/v6/forward");
    expect(url).toContain("q=10%20Downing%20St%2C%20London");
    expect(url).toContain("limit=1");
    expect(url).toContain("access_token=tok123");
    expect(url).not.toContain("proximity");
  });

  it("adds proximity (lng,lat) and country bias when given", () => {
    const url = buildGeocodeUrl("St Paul's", "tok", {
      proximity: { lat: 51.5, lng: -0.12 },
      country: "gb",
    });
    expect(url).toContain("proximity=-0.12,51.5");
    expect(url).toContain("country=gb");
  });
});

describe("parseGeocode", () => {
  it("extracts lat/lng from the first feature", () => {
    const json = { features: [{ geometry: { coordinates: [-0.1276, 51.5034] } }] };
    expect(parseGeocode(json)).toEqual({ lat: 51.5034, lng: -0.1276 });
  });

  it("returns null when there are no features", () => {
    expect(parseGeocode({ features: [] })).toBeNull();
    expect(parseGeocode({})).toBeNull();
  });
});
