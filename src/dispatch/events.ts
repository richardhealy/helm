import { prisma } from "@/lib/db";

export type DispatchEventInput = {
  type: string;
  actor: string;
  vehicleId?: string;
  deliveryId?: string;
  routeId?: string;
  detail?: string;
};

export type DispatchEventView = {
  id: string;
  type: string;
  actor: string;
  detail: string | null;
  createdAt: string;
};

export async function logEvent(input: DispatchEventInput): Promise<void> {
  await prisma.dispatchEvent.create({ data: input });
}

export async function listEvents(limit = 30): Promise<DispatchEventView[]> {
  const rows = await prisma.dispatchEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    actor: e.actor,
    detail: e.detail,
    createdAt: e.createdAt.toISOString(),
  }));
}
