-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('unassigned', 'assigned', 'en_route', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('draft', 'active', 'completed');

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'unassigned',
    "vehicleId" TEXT,
    "sequence" INTEGER,
    "serviceDuration" INTEGER NOT NULL DEFAULT 0,
    "timeWindowStart" TIMESTAMP(3),
    "timeWindowEnd" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'active',
    "geometry" JSONB NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "optimizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteLeg" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "eta" TIMESTAMP(3) NOT NULL,
    "toDeliveryId" TEXT,

    CONSTRAINT "RouteLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Delivery_vehicleId_sequence_idx" ON "Delivery"("vehicleId", "sequence");

-- CreateIndex
CREATE INDEX "Route_vehicleId_idx" ON "Route"("vehicleId");

-- CreateIndex
CREATE INDEX "RouteLeg_routeId_sequence_idx" ON "RouteLeg"("routeId", "sequence");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteLeg" ADD CONSTRAINT "RouteLeg_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteLeg" ADD CONSTRAINT "RouteLeg_toDeliveryId_fkey" FOREIGN KEY ("toDeliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
