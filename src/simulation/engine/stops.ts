import type { Stop } from "./step";

export function cumulativeStops(
  legs: { distance: number; toDeliveryId: string | null }[],
): Stop[] {
  const stops: Stop[] = [];
  let acc = 0;
  for (const leg of legs) {
    acc += leg.distance;
    if (leg.toDeliveryId) {
      stops.push({ deliveryId: leg.toDeliveryId, distanceAlong: acc });
    }
  }
  return stops;
}
