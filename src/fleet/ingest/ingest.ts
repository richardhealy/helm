import { prisma } from "@/lib/db";
import { positionPingInput, type PositionPingInput } from "./contract";

/**
 * The single entry point for position data. Validates against the contract,
 * appends a ping, projects the vehicle's current position, and notifies
 * realtime subscribers via Postgres LISTEN/NOTIFY.
 */
export async function ingestPing(
  input: PositionPingInput,
): Promise<{ id: string }> {
  const p = positionPingInput.parse(input);
  const timestamp = p.timestamp ?? new Date();

  const ping = await prisma.positionPing.create({
    data: {
      vehicleId: p.vehicleId,
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      speed: p.speed,
      source: p.source,
      timestamp,
    },
  });

  await prisma.vehicle.update({
    where: { id: p.vehicleId },
    data: {
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      speed: p.speed,
      positionUpdatedAt: timestamp,
    },
  });

  const payload = JSON.stringify({
    vehicleId: p.vehicleId,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    speed: p.speed,
    timestamp,
  });
  // pg_notify's channel must be a literal; the payload is bound as a parameter.
  await prisma.$executeRawUnsafe("SELECT pg_notify('vehicle_position', $1)", payload);

  return { id: ping.id };
}
