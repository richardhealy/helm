import { describe, it, expect } from "vitest";
import { geocodeAddress } from "./geocode";

describe("geocodeAddress (live Mapbox)", () => {
  it("resolves a real address to plausible London coordinates", async () => {
    const result = await geocodeAddress("Trafalgar Square, London");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeGreaterThan(51.3);
    expect(result!.lat).toBeLessThan(51.7);
    expect(result!.lng).toBeGreaterThan(-0.3);
    expect(result!.lng).toBeLessThan(0.1);
  });
});
