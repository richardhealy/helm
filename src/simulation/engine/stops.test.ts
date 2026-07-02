import { describe, it, expect } from "vitest";
import { cumulativeStops } from "./stops";

describe("cumulativeStops", () => {
  it("accumulates leg distances into per-stop distances", () => {
    const stops = cumulativeStops([
      { distance: 1000, toDeliveryId: "a" },
      { distance: 2000, toDeliveryId: "b" },
      { distance: 500, toDeliveryId: null }, // return to depot — skipped
    ]);
    expect(stops).toEqual([
      { deliveryId: "a", distanceAlong: 1000 },
      { deliveryId: "b", distanceAlong: 3000 },
    ]);
  });
});
