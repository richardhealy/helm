import { prisma } from "@/lib/db";
import { ingestPing } from "@/fleet/ingest/ingest";
import { logEvent } from "@/dispatch/events";
import { simulateStep } from "./engine/step";
import { cumulativeStops } from "./engine/stops";

type TickOpts = { speedMps: number; dtSeconds: number };

export async function tickVehicle(
  vehicleId: string,
  opts: TickOpts,
): Promise<{ moved: boolean; arrived: string[]; completed: boolean }> {
  const route = await prisma.route.findFirst({
    where: { vehicleId, status: "active" },
    include: { legs: { orderBy: { sequence: "asc" } } },
  });
  if (!route) return { moved: false, arrived: [], completed: false };

  const geometry = route.geometry as unknown as {
    coordinates: [number, number][];
  };
  const stops = cumulativeStops(
    route.legs.map((l) => ({ distance: l.distance, toDeliveryId: l.toDeliveryId })),
  );

  const result = simulateStep({
    coords: geometry.coordinates,
    progressMeters: route.progressMeters,
    totalMeters: route.distance,
    stops,
    speedMps: opts.speedMps,
    dtSeconds: opts.dtSeconds,
  });

  // On the first movement, mark the vehicle and its stops en_route.
  if (route.progressMeters === 0) {
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: "en_route" },
    });
    await prisma.delivery.updateMany({
      where: { vehicleId, status: "assigned" },
      data: { status: "en_route" },
    });
  }

  // Emit the position through the ingest contract (source: simulation).
  await ingestPing({
    vehicleId,
    lat: result.position.lat,
    lng: result.position.lng,
    heading: result.position.heading,
    speed: opts.speedMps,
    source: "simulation",
  });

  // Mark arrivals delivered (exactly once — they leave the en_route filter).
  for (const deliveryId of result.arrivedDeliveryIds) {
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: "delivered", completedAt: new Date() },
    });
    await prisma.$executeRawUnsafe(
      "SELECT pg_notify('stop_status', $1)",
      JSON.stringify({ deliveryId, status: "delivered" }),
    );
    await logEvent({
      type: "arrived",
      actor: "simulation",
      vehicleId,
      deliveryId,
    });
  }

  await prisma.route.update({
    where: { id: route.id },
    data: { progressMeters: result.newProgressMeters },
  });

  if (result.completed) {
    await prisma.route.update({
      where: { id: route.id },
      data: { status: "completed" },
    });
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: "idle" },
    });
    await logEvent({
      type: "completed",
      actor: "simulation",
      vehicleId,
      routeId: route.id,
    });
  }

  return {
    moved: true,
    arrived: result.arrivedDeliveryIds,
    completed: result.completed,
  };
}

export async function tickAll(opts: TickOpts): Promise<void> {
  const routes = await prisma.route.findMany({
    where: { status: "active" },
    select: { vehicleId: true },
  });
  for (const { vehicleId } of routes) {
    await tickVehicle(vehicleId, opts);
  }
}

/**
 * Demo helper: reset every completed route back to the start (active, progress
 * 0) and its delivered stops to en_route, so the fleet drives its routes again.
 * Opt-in (the simulator calls this only when SIM_LOOP is set) — production
 * fleets do not auto-replay deliveries. Returns the number of routes reset.
 */
export async function redispatchCompletedRoutes(): Promise<number> {
  const completed = await prisma.route.findMany({
    where: { status: "completed" },
    select: { id: true, vehicleId: true },
  });
  for (const route of completed) {
    await prisma.route.update({
      where: { id: route.id },
      data: { status: "active", progressMeters: 0 },
    });
    await prisma.delivery.updateMany({
      where: { vehicleId: route.vehicleId, status: "delivered" },
      data: { status: "en_route" },
    });
  }
  return completed.length;
}
