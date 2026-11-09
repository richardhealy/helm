import { prisma } from "@/lib/db";

/** Thrown when a write names a vehicle id that matches no vehicle. */
export class VehicleNotFoundError extends Error {
  constructor(vehicleId: string) {
    super(`Vehicle ${vehicleId} not found`);
    this.name = "VehicleNotFoundError";
  }
}

export type VehicleSummary = {
  id: string;
  label: string;
  status: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  speed: number | null;
};

export async function createDepot(input: {
  name: string;
  lat: number;
  lng: number;
}) {
  return prisma.depot.create({ data: input });
}

export async function createVehicle(input: {
  label: string;
  type?: string;
  capacity?: number;
  depotId?: string;
}) {
  return prisma.vehicle.create({ data: input });
}

export async function listVehicles(): Promise<VehicleSummary[]> {
  const vehicles = await prisma.vehicle.findMany({ orderBy: { label: "asc" } });
  return vehicles.map((v) => ({
    id: v.id,
    label: v.label,
    status: v.status,
    lat: v.lat,
    lng: v.lng,
    heading: v.heading,
    speed: v.speed,
  }));
}
