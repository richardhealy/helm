export type LngLat = { lat: number; lng: number };

export type OptimizedTrip = {
  geometry: GeoJSON.LineString;
  distance: number;
  duration: number;
  legs: { distance: number; duration: number }[];
  orderedStopIndices: number[];
};

export function buildOptimizationUrl(coords: LngLat[], token: string): string {
  const path = coords.map((c) => `${c.lng},${c.lat}`).join(";");
  // roundtrip from the depot: depot -> optimized stops -> depot. This lets the
  // optimizer choose the full visiting order (unlike destination=last), and is
  // the combination Optimization v1 supports (source=first + roundtrip=true).
  const params = new URLSearchParams({
    source: "first",
    roundtrip: "true",
    geometries: "geojson",
    overview: "full",
    access_token: token,
  });
  return `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${path}?${params.toString()}`;
}

export function parseOptimization(json: unknown): OptimizedTrip | null {
  const o = json as {
    code?: string;
    waypoints?: { waypoint_index: number }[];
    trips?: {
      distance: number;
      duration: number;
      geometry: GeoJSON.LineString;
      legs: { distance: number; duration: number }[];
    }[];
  };
  if (o?.code !== "Ok" || !o.waypoints || !o.trips || o.trips.length === 0) {
    return null;
  }
  const trip = o.trips[0];
  // waypoints[0] is the depot (source=first). The remaining waypoints map 1:1
  // to the input stops; sort those stop indices by their optimized position.
  const stops = o.waypoints
    .slice(1)
    .map((w, i) => ({ stopIndex: i, waypointIndex: w.waypoint_index }));
  stops.sort((a, b) => a.waypointIndex - b.waypointIndex);
  return {
    geometry: trip.geometry,
    distance: trip.distance,
    duration: trip.duration,
    legs: trip.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
    orderedStopIndices: stops.map((s) => s.stopIndex),
  };
}

export async function optimizeTrip(
  coords: LngLat[],
): Promise<OptimizedTrip | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not set");
  const res = await fetch(buildOptimizationUrl(coords, token));
  if (!res.ok) return null;
  return parseOptimization(await res.json());
}
