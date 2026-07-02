import { prisma } from "@/lib/db";
import { geocodeAddress, type GeocodeBias } from "@/deliveries/geocode/geocode";

export type DeliverySummary = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  status: string;
  vehicleId: string | null;
  sequence: number | null;
};

type DeliveryRow = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  status: string;
  vehicleId: string | null;
  sequence: number | null;
};

function toSummary(d: DeliveryRow): DeliverySummary {
  return {
    id: d.id,
    address: d.address,
    lat: d.lat,
    lng: d.lng,
    status: d.status,
    vehicleId: d.vehicleId,
    sequence: d.sequence,
  };
}

export async function createDelivery(input: {
  address: string;
  bias?: GeocodeBias;
}): Promise<DeliverySummary> {
  const coords = await geocodeAddress(input.address, input.bias);
  if (!coords) throw new Error("Could not geocode address");
  const d = await prisma.delivery.create({
    data: { address: input.address, lat: coords.lat, lng: coords.lng },
  });
  return toSummary(d);
}

export async function listUnassigned(): Promise<DeliverySummary[]> {
  const rows = await prisma.delivery.findMany({
    where: { status: "unassigned" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSummary);
}

export async function listForVehicle(
  vehicleId: string,
): Promise<DeliverySummary[]> {
  const rows = await prisma.delivery.findMany({
    where: { vehicleId },
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toSummary);
}

export async function assignDelivery(
  deliveryId: string,
  vehicleId: string,
): Promise<void> {
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { vehicleId, status: "assigned", assignedAt: new Date() },
  });
}

export async function unassignDelivery(deliveryId: string): Promise<void> {
  await prisma.delivery.update({
    where: { id: deliveryId },
    data: { vehicleId: null, sequence: null, status: "unassigned" },
  });
}
