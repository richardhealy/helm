import { describe, it, expect } from "vitest";
import { formatEta, fleetStatusLine } from "./format";

describe("formatEta", () => {
  it("returns a dash for null", () => {
    expect(formatEta(null)).toBe("—");
  });
  it("formats an ISO time as HH:MM", () => {
    // 09:05 UTC — assert the shape, not the tz-shifted value
    expect(formatEta("2026-07-03T09:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("fleetStatusLine", () => {
  it("counts vehicles and those en route", () => {
    expect(
      fleetStatusLine([{ status: "idle" }, { status: "en_route" }, { status: "en_route" }]),
    ).toBe("3 vehicles · 2 en route");
  });
});
