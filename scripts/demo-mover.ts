import "./load-env";
import { createDepot, createVehicle, listVehicles } from "../src/fleet/registry/vehicles";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const CENTER = { lat: 51.5, lng: -0.12 };
const RADIUS = 0.02; // ~2 km

async function ensureVehicle(): Promise<string> {
  const existing = await listVehicles();
  if (existing.length > 0) return existing[0].id;
  const depot = await createDepot({ name: "Demo Depot", ...CENTER });
  const vehicle = await createVehicle({ label: "Demo Van", depotId: depot.id });
  return vehicle.id;
}

async function main() {
  const vehicleId = await ensureVehicle();
  console.log(`Moving vehicle ${vehicleId}. Open ${APP_URL}/dashboard`);

  let angle = 0;
  setInterval(async () => {
    angle = (angle + 5) % 360;
    const rad = (angle * Math.PI) / 180;
    const lat = CENTER.lat + RADIUS * Math.sin(rad);
    const lng = CENTER.lng + RADIUS * Math.cos(rad);
    const heading = (angle + 90) % 360; // tangent to the circle

    const res = await fetch(`${APP_URL}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId, lat, lng, heading, speed: 8 }),
    });
    if (!res.ok) console.error("ingest failed", res.status, await res.text());
  }, 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
