import "./load-env";
import { createDepot, createVehicle, listVehicles } from "../src/fleet/registry/vehicles";
import { assignDelivery } from "../src/deliveries/orders/deliveries";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const ADDRESSES = [
  "Covent Garden, London",
  "British Museum, London",
  "St Paul's Cathedral, London",
  "Tate Modern, London",
  "Borough Market, London",
];

async function ensureVehicle(): Promise<string> {
  const existing = await listVehicles();
  if (existing.length > 0 && existing[0].lat !== null) return existing[0].id;
  const depot = await createDepot({ name: "Demo Depot", lat: 51.5, lng: -0.12 });
  const vehicle = await createVehicle({ label: "Demo Van", depotId: depot.id });
  return vehicle.id;
}

async function main() {
  const vehicleId = await ensureVehicle();

  for (const address of ADDRESSES) {
    const res = await fetch(`${APP_URL}/api/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Bias geocoding to GB + the depot so "St Paul's Cathedral, London"
      // resolves in London, not the St. Pauls in North Carolina.
      body: JSON.stringify({
        address,
        bias: { country: "gb", proximity: { lat: 51.5, lng: -0.12 } },
      }),
    });
    if (!res.ok) {
      console.error("create delivery failed", address, res.status);
      continue;
    }
    const delivery = (await res.json()) as { id: string };
    await assignDelivery(delivery.id, vehicleId);
    console.log(`added + assigned: ${address}`);
  }

  const opt = await fetch(`${APP_URL}/api/vehicles/${vehicleId}/optimize`, {
    method: "POST",
  });
  console.log("optimize:", opt.status, await opt.text());
  console.log(`Open ${APP_URL}/dashboard — the optimized route should be drawn.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
