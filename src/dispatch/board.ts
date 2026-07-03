import { prisma } from "@/lib/db";
import { getActiveRoute } from "@/routing/routes/routes";
import { listEvents, type DispatchEventView } from "./events";

export type BoardStop = {
  id: string;
  address: string;
  status: string;
  sequence: number | null;
  eta: string | null;
};

export type BoardVehicle = {
  id: string;
  label: string;
  status: string;
  stops: BoardStop[];
};

export type DispatchBoard = {
  unassigned: { id: string; address: string }[];
  vehicles: BoardVehicle[];
  events: DispatchEventView[];
};

export async function getDispatchBoard(): Promise<DispatchBoard> {
  const [unassignedRows, vehicles, events] = await Promise.all([
    prisma.delivery.findMany({
      where: { status: "unassigned" },
      orderBy: { createdAt: "asc" },
      select: { id: true, address: true },
    }),
    prisma.vehicle.findMany({ orderBy: { label: "asc" } }),
    listEvents(20),
  ]);

  const boardVehicles: BoardVehicle[] = [];
  for (const v of vehicles) {
    const [stops, route] = await Promise.all([
      prisma.delivery.findMany({
        where: { vehicleId: v.id, status: { not: "unassigned" } },
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
      }),
      getActiveRoute(v.id),
    ]);
    const etaByDelivery = new Map(
      (route?.legs ?? []).map((l) => [l.toDeliveryId, l.eta.toISOString()]),
    );
    boardVehicles.push({
      id: v.id,
      label: v.label,
      status: v.status,
      stops: stops.map((s) => ({
        id: s.id,
        address: s.address,
        status: s.status,
        sequence: s.sequence,
        eta: etaByDelivery.get(s.id) ?? null,
      })),
    });
  }

  return {
    unassigned: unassignedRows.map((d) => ({ id: d.id, address: d.address })),
    vehicles: boardVehicles,
    events,
  };
}
