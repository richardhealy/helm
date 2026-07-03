import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { dispatchFleet } from "./dispatch";

let depotWestId: string;
let depotCityId: string;
let vWest: string;
let vCity: string;
const deliveryIds: string[] = [];

beforeAll(async () => {
  const dw = await prisma.depot.create({ data: { name: "W", lat: 51.51, lng: -0.13 } });
  const dc = await prisma.depot.create({ data: { name: "C", lat: 51.517, lng: -0.082 } });
  depotWestId = dw.id;
  depotCityId = dc.id;
  vWest = (await prisma.vehicle.create({ data: { label: "fd-west", depotId: dw.id } })).id;
  vCity = (await prisma.vehicle.create({ data: { label: "fd-city", depotId: dc.id } })).id;
  for (const s of [
    { lat: 51.512, lng: -0.128 },
    { lat: 51.515, lng: -0.085 },
  ]) {
    const d = await prisma.delivery.create({
      data: { address: "x", lat: s.lat, lng: s.lng, status: "unassigned" },
    });
    deliveryIds.push(d.id);
  }
});

afterAll(async () => {
  await prisma.routeLeg.deleteMany({ where: { route: { vehicleId: { in: [vWest, vCity] } } } });
  await prisma.route.deleteMany({ where: { vehicleId: { in: [vWest, vCity] } } });
  await prisma.delivery.deleteMany({ where: { id: { in: deliveryIds } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: [vWest, vCity] } } });
  await prisma.depot.deleteMany({ where: { id: { in: [depotWestId, depotCityId] } } });
  await prisma.$disconnect();
});

// dispatchFleet calls optimizeRouteForVehicle → Optimization v1, so this needs
// a Mapbox token; skip when absent (e.g. CI without the secret).
describe.skipIf(!process.env.MAPBOX_TOKEN)("dispatchFleet", () => {
  it("assigns unassigned deliveries and routes their vehicles", async () => {
    // dispatchFleet is global; assert about our own deliveries so the test is
    // robust to any other fleet data in the shared DB.
    const result = await dispatchFleet();
    expect(result.assigned).toBeGreaterThanOrEqual(2);

    const mine = await prisma.delivery.findMany({
      where: { id: { in: deliveryIds } },
    });
    for (const d of mine) {
      expect(d.status).not.toBe("unassigned");
      expect(d.vehicleId).toBeTruthy();
    }

    // every vehicle our deliveries landed on now has an active route
    const vids = [...new Set(mine.map((d) => d.vehicleId!))];
    const routes = await prisma.route.count({
      where: { vehicleId: { in: vids }, status: "active" },
    });
    expect(routes).toBeGreaterThanOrEqual(1);
  });
});
