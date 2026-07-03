import { describe, it, expect } from "vitest";
import { assignNearest } from "./assign";

describe("assignNearest", () => {
  const vehicles = [
    { vehicleId: "west", lat: 51.51, lng: -0.13 },
    { vehicleId: "city", lat: 51.517, lng: -0.082 },
  ];

  it("assigns each stop to the nearest vehicle depot", () => {
    const result = assignNearest(
      [
        { id: "a", lat: 51.512, lng: -0.128 }, // near west
        { id: "b", lat: 51.515, lng: -0.085 }, // near city
      ],
      vehicles,
    );
    expect(result).toContainEqual({ deliveryId: "a", vehicleId: "west" });
    expect(result).toContainEqual({ deliveryId: "b", vehicleId: "city" });
  });

  it("returns nothing when there are no vehicles", () => {
    expect(assignNearest([{ id: "a", lat: 51.5, lng: -0.1 }], [])).toEqual([]);
  });
});
