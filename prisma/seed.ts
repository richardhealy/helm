import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DEPOTS = [
  { name: "City Depot", lat: 51.517, lng: -0.082, vehicle: "Van 1 · City" },
  { name: "West End Depot", lat: 51.51, lng: -0.128, vehicle: "Van 2 · West End" },
  { name: "Westminster Depot", lat: 51.5, lng: -0.12, vehicle: "Van 3 · Westminster" },
];

async function main() {
  await prisma.routeLeg.deleteMany({});
  await prisma.route.deleteMany({});
  await prisma.positionPing.deleteMany({});
  await prisma.delivery.deleteMany({});
  await prisma.vehicle.deleteMany({});
  await prisma.depot.deleteMany({});

  for (const d of DEPOTS) {
    const depot = await prisma.depot.create({
      data: { name: d.name, lat: d.lat, lng: d.lng },
    });
    await prisma.vehicle.create({
      data: { label: d.vehicle, depotId: depot.id },
    });
  }
  console.log(`Seeded ${DEPOTS.length} depots + vehicles.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
