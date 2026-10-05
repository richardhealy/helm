import { prisma } from "@/lib/db";
import { geocodeAddress, type GeocodeBias } from "@/deliveries/geocode/geocode";
import { logEvent } from "@/dispatch/events";
import { FINAL_STATUSES } from "./lifecycle";

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

export class DeliveryNotFoundError extends Error {
  constructor(deliveryId: string) {
    super(`Delivery ${deliveryId} not found`);
    this.name = "DeliveryNotFoundError";
  }
}

export class DeliveryStateError extends Error {
  constructor(deliveryId: string, status: string) {
    super(`Delivery ${deliveryId} is already ${status} and can't be changed`);
    this.name = "DeliveryStateError";
  }
}

/**
 * Apply a dispatcher change to a stop that is still in play. The status check
 * is part of the UPDATE, so a stop the simulator delivers at the same moment
 * can't be pulled back into the pool.
 */
async function updateOpenDelivery(
  deliveryId: string,
  data: {
    vehicleId: string | null;
    status: "assigned" | "unassigned";
    assignedAt?: Date;
    sequence?: null;
  },
) {
  const { count } = await prisma.delivery.updateMany({
    where: { id: deliveryId, status: { notIn: [...FINAL_STATUSES] } },
    data,
  });
  if (count === 0) {
    const existing = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { status: true },
    });
    if (!existing) throw new DeliveryNotFoundError(deliveryId);
    throw new DeliveryStateError(deliveryId, existing.status);
  }
  return prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
}

export async function assignDelivery(
  deliveryId: string,
  vehicleId: string,
): Promise<void> {
  const delivery = await updateOpenDelivery(deliveryId, {
    vehicleId,
    status: "assigned",
    assignedAt: new Date(),
  });
  await logEvent({
    type: "assigned",
    actor: "dispatcher",
    deliveryId,
    vehicleId,
    detail: delivery.address,
  });
}

export async function unassignDelivery(deliveryId: string): Promise<void> {
  const delivery = await updateOpenDelivery(deliveryId, {
    vehicleId: null,
    sequence: null,
    status: "unassigned",
  });
  await logEvent({
    type: "unassigned",
    actor: "dispatcher",
    deliveryId,
    detail: delivery.address,
  });
}
