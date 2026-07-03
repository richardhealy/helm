import { prisma } from "@/lib/db";
import { assignDelivery } from "@/deliveries/orders/deliveries";
import { optimizeRouteForVehicle } from "@/routing/routes/routes";
import { assignNearest, type VehicleDepot, type UnassignedStop } from "./assign";

export async function dispatchFleet(): Promise<{
  assigned: number;
  vehicles: number;
}> {
  const [stops, vehicles] = await Promise.all([
    prisma.delivery.findMany({
      where: { status: "unassigned" },
      select: { id: true, lat: true, lng: true },
    }),
    prisma.vehicle.findMany({
      where: { depotId: { not: null } },
      include: { depot: true },
    }),
  ]);

  const depots: VehicleDepot[] = vehicles
    .filter((v) => v.depot)
    .map((v) => ({ vehicleId: v.id, lat: v.depot!.lat, lng: v.depot!.lng }));

  if (stops.length === 0 || depots.length === 0) {
    return { assigned: 0, vehicles: 0 };
  }

  const unassigned: UnassignedStop[] = stops.map((s) => ({
    id: s.id,
    lat: s.lat,
    lng: s.lng,
  }));
  const assignments = assignNearest(unassigned, depots);

  for (const a of assignments) {
    await assignDelivery(a.deliveryId, a.vehicleId);
  }

  const affected = [...new Set(assignments.map((a) => a.vehicleId))];
  for (const vehicleId of affected) {
    await optimizeRouteForVehicle(vehicleId);
  }

  return { assigned: assignments.length, vehicles: affected.length };
}
