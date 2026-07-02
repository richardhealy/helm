import { prisma } from "@/lib/db";
import type { StopView } from "@/console/map/stops";

export async function listRouteStops(): Promise<StopView[]> {
  const rows = await prisma.delivery.findMany({
    where: { status: { in: ["assigned", "en_route", "delivered"] } },
    orderBy: [{ vehicleId: "asc" }, { sequence: "asc" }],
  });
  return rows.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, status: d.status }));
}
