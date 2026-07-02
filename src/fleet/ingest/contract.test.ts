import { describe, it, expect } from "vitest";
import { positionPingInput } from "./contract";

describe("positionPingInput", () => {
  const base = { vehicleId: "v1", lat: 51.5, lng: -0.12, heading: 90, speed: 8 };

  it("accepts a valid ping and defaults source to simulation", () => {
    const parsed = positionPingInput.parse(base);
    expect(parsed.source).toBe("simulation");
    expect(parsed.vehicleId).toBe("v1");
  });

  it("rejects out-of-range latitude", () => {
    expect(() => positionPingInput.parse({ ...base, lat: 200 })).toThrow();
  });

  it("rejects a heading over 360", () => {
    expect(() => positionPingInput.parse({ ...base, heading: 400 })).toThrow();
  });

  it("rejects a missing vehicleId", () => {
    const { vehicleId: _omit, ...rest } = base;
    void _omit;
    expect(() => positionPingInput.parse(rest)).toThrow();
  });
});
