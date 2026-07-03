import { prisma } from "@/lib/db";
import { optimizeTrip, type OptimizedTrip, type LngLat } from "@/routing/optimize/optimize";
import { logEvent } from "@/dispatch/events";

const MAX_STOPS = 11; // Optimization v1: depot + 11 stops = 12 coordinates

export async function persistRoute(
  vehicleId: string,
  orderedDeliveryIds: string[],
  trip: OptimizedTrip,
  startedAt: Date,
): Promise<{ routeId: string }> {
  // Replace any existing route for this vehicle (cascade removes its legs).
  await prisma.route.deleteMany({ where: { vehicleId } });

  const route = await prisma.route.create({
    data: {
      vehicleId,
      status: "active",
      geometry: trip.geometry as unknown as object,
      distance: trip.distance,
      duration: trip.duration,
      optimizedAt: startedAt,
    },
  });

  let cumulativeMs = 0;
  for (let i = 0; i < orderedDeliveryIds.length; i++) {
    cumulativeMs += (trip.legs[i]?.duration ?? 0) * 1000;
    const eta = new Date(startedAt.getTime() + cumulativeMs);
    await prisma.routeLeg.create({
      data: {
        routeId: route.id,
        sequence: i,
        distance: trip.legs[i]?.distance ?? 0,
        duration: trip.legs[i]?.duration ?? 0,
        eta,
        toDeliveryId: orderedDeliveryIds[i],
      },
    });
    await prisma.delivery.update({
      where: { id: orderedDeliveryIds[i] },
      data: { sequence: i },
    });
  }

  const payload = JSON.stringify({ vehicleId, routeId: route.id });
  await prisma.$executeRawUnsafe("SELECT pg_notify('route_updated', $1)", payload);

  await logEvent({
    type: "optimized",
    actor: "dispatcher",
    vehicleId,
    routeId: route.id,
    detail: `${orderedDeliveryIds.length} stops`,
  });

  return { routeId: route.id };
}

export async function optimizeRouteForVehicle(
  vehicleId: string,
): Promise<{ routeId: string } | null> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { depot: true },
  });
  if (!vehicle?.depot) return null;

  const deliveries = await prisma.delivery.findMany({
    where: { vehicleId, status: "assigned" },
    orderBy: { createdAt: "asc" },
    take: MAX_STOPS,
  });
  if (deliveries.length === 0) return null;

  const coords: LngLat[] = [
    { lat: vehicle.depot.lat, lng: vehicle.depot.lng },
    ...deliveries.map((d) => ({ lat: d.lat, lng: d.lng })),
  ];

  const trip = await optimizeTrip(coords);
  if (!trip) return null;

  const ordered = trip.orderedStopIndices.map((i) => deliveries[i].id);
  return persistRoute(vehicleId, ordered, trip, new Date());
}

export async function getActiveRoute(vehicleId: string) {
  const route = await prisma.route.findFirst({
    where: { vehicleId, status: "active" },
    include: { legs: { orderBy: { sequence: "asc" } } },
  });
  if (!route) return null;
  return {
    id: route.id,
    geometry: route.geometry,
    legs: route.legs.map((l) => ({
      sequence: l.sequence,
      eta: l.eta,
      toDeliveryId: l.toDeliveryId,
    })),
  };
}
