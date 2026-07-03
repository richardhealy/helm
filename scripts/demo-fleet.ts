import "./load-env";
import { prisma } from "../src/lib/db";
import { createDepot, createVehicle } from "../src/fleet/registry/vehicles";
import { assignDelivery } from "../src/deliveries/orders/deliveries";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const BIAS = { country: "gb", proximity: { lat: 51.51, lng: -0.12 } };

// Three vans, each working a different quarter of central London.
const FLEET = [
  {
    label: "Van 1 · City",
    depot: { lat: 51.517, lng: -0.082 },
    stops: [
      "Liverpool Street Station, London EC2M 7PY",
      "St Paul's Cathedral, London EC4M 8AD",
      "Bank of England, London EC2R 8AH",
    ],
  },
  {
    label: "Van 2 · West End",
    depot: { lat: 51.51, lng: -0.128 },
    stops: [
      "Covent Garden, London WC2E 8RF",
      "Trafalgar Square, London WC2N 5DN",
      "Piccadilly Circus, London W1J 9HS",
    ],
  },
  {
    label: "Van 3 · Westminster",
    depot: { lat: 51.5, lng: -0.12 },
    stops: [
      "Westminster Abbey, London SW1P 3PA",
      "London Eye, London SE1 7PB",
      "Waterloo Station, London SE1 8SW",
    ],
  },
];

async function reset() {
  // Clear all fleet data so the demo starts from a clean slate.
  await prisma.routeLeg.deleteMany({});
  await prisma.route.deleteMany({});
  await prisma.positionPing.deleteMany({});
  await prisma.delivery.deleteMany({});
  await prisma.vehicle.deleteMany({});
  await prisma.depot.deleteMany({});
}

async function createDelivery(address: string): Promise<string> {
  const res = await fetch(`${APP_URL}/api/deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, bias: BIAS }),
  });
  if (!res.ok) throw new Error(`create delivery failed for ${address}: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function main() {
  await reset();

  for (const van of FLEET) {
    const depot = await createDepot({ name: `${van.label} Depot`, ...van.depot });
    const vehicle = await createVehicle({ label: van.label, depotId: depot.id });

    for (const address of van.stops) {
      const deliveryId = await createDelivery(address);
      await assignDelivery(deliveryId, vehicle.id);
    }

    const res = await fetch(`${APP_URL}/api/vehicles/${vehicle.id}/optimize`, {
      method: "POST",
    });
    console.log(`${van.label}: optimize ${res.status}`);
  }

  await prisma.$disconnect();
  console.log(`Fleet ready. Open ${APP_URL}/dashboard and run the simulator.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
