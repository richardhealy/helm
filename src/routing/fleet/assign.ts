import { haversine } from "@/simulation/engine/geo";

export type VehicleDepot = { vehicleId: string; lat: number; lng: number };
export type UnassignedStop = { id: string; lat: number; lng: number };

export function assignNearest(
  stops: UnassignedStop[],
  vehicles: VehicleDepot[],
): { deliveryId: string; vehicleId: string }[] {
  if (vehicles.length === 0) return [];
  return stops.map((stop) => {
    let best = vehicles[0];
    let bestDist = haversine(stop, best);
    for (const v of vehicles.slice(1)) {
      const d = haversine(stop, v);
      if (d < bestDist) {
        best = v;
        bestDist = d;
      }
    }
    return { deliveryId: stop.id, vehicleId: best.vehicleId };
  });
}
