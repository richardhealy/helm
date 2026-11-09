import { isForeignKeyViolation, prisma } from "@/lib/db";
import { VehicleNotFoundError } from "@/fleet/registry/vehicles";
import { positionPingInput, type PositionPingInput } from "./contract";

/**
 * The single entry point for position data. Validates against the contract,
 * appends a ping, projects the vehicle's current position, and notifies
 * realtime subscribers via Postgres LISTEN/NOTIFY.
 *
 * Throws VehicleNotFoundError when the vehicle id matches no vehicle. The
 * check is the foreign key on the ping insert, so a refused ping stores
 * nothing, moves no vehicle and sends no notification.
 */
export async function ingestPing(
  input: PositionPingInput,
): Promise<{ id: string }> {
  const p = positionPingInput.parse(input);
  const timestamp = p.timestamp ?? new Date();

  let ping;
  try {
    ping = await prisma.positionPing.create({
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
  } catch (err) {
    // vehicleId is the ping's only foreign key, so a violation means no
    // vehicle has that id.
    if (isForeignKeyViolation(err)) throw new VehicleNotFoundError(p.vehicleId);
    throw err;
  }

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
