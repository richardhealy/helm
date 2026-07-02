import { pointAlongLine } from "./geo";

export type Stop = { deliveryId: string; distanceAlong: number };

export type StepInput = {
  coords: [number, number][];
  progressMeters: number;
  totalMeters: number;
  stops: Stop[];
  speedMps: number;
  dtSeconds: number;
};

export type StepResult = {
  newProgressMeters: number;
  position: { lat: number; lng: number; heading: number };
  arrivedDeliveryIds: string[];
  completed: boolean;
};

export function simulateStep(input: StepInput): StepResult {
  const advanced = input.progressMeters + input.speedMps * input.dtSeconds;
  const newProgressMeters = Math.min(advanced, input.totalMeters);

  const arrivedDeliveryIds = input.stops
    .filter(
      (s) =>
        s.distanceAlong > input.progressMeters &&
        s.distanceAlong <= newProgressMeters,
    )
    .map((s) => s.deliveryId);

  return {
    newProgressMeters,
    position: pointAlongLine(input.coords, newProgressMeters),
    arrivedDeliveryIds,
    completed: newProgressMeters >= input.totalMeters,
  };
}
