import { describe, it, expect } from "vitest";
import { simulateStep } from "./step";

// A straight ~111km eastbound line from (0,0) to (0,1) (~111,320 m).
const coords: [number, number][] = [
  [0, 0],
  [1, 0],
];
const total = 111_320;

describe("simulateStep", () => {
  it("advances progress by speed*dt and does not arrive early", () => {
    const r = simulateStep({
      coords,
      progressMeters: 0,
      totalMeters: total,
      stops: [{ deliveryId: "d1", distanceAlong: total }],
      speedMps: 100,
      dtSeconds: 1,
    });
    expect(r.newProgressMeters).toBeCloseTo(100, 0);
    expect(r.arrivedDeliveryIds).toEqual([]);
    expect(r.completed).toBe(false);
  });

  it("marks a stop arrived when its distance is crossed", () => {
    const r = simulateStep({
      coords,
      progressMeters: 400,
      totalMeters: total,
      stops: [{ deliveryId: "d1", distanceAlong: 500 }],
      speedMps: 200,
      dtSeconds: 1,
    });
    expect(r.newProgressMeters).toBeCloseTo(600, 0);
    expect(r.arrivedDeliveryIds).toEqual(["d1"]);
  });

  it("clamps at the end and reports completed", () => {
    const r = simulateStep({
      coords,
      progressMeters: total - 50,
      totalMeters: total,
      stops: [{ deliveryId: "d1", distanceAlong: total }],
      speedMps: 1000,
      dtSeconds: 1,
    });
    expect(r.newProgressMeters).toBe(total);
    expect(r.completed).toBe(true);
    expect(r.arrivedDeliveryIds).toEqual(["d1"]);
  });
});
