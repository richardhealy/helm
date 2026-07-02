export type LatLng = { lat: number; lng: number };

const R = 6_371_000; // Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function pointAlongLine(
  coords: [number, number][],
  distanceMeters: number,
): { lat: number; lng: number; heading: number } {
  if (coords.length === 0) throw new Error("empty line");
  const pts: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
  if (coords.length === 1 || distanceMeters <= 0) {
    const next = pts[1] ?? pts[0];
    return { ...pts[0], heading: bearing(pts[0], next) };
  }

  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const segLen = haversine(pts[i], pts[i + 1]);
    if (acc + segLen >= distanceMeters) {
      const t = segLen === 0 ? 0 : (distanceMeters - acc) / segLen;
      return {
        lat: pts[i].lat + t * (pts[i + 1].lat - pts[i].lat),
        lng: pts[i].lng + t * (pts[i + 1].lng - pts[i].lng),
        heading: bearing(pts[i], pts[i + 1]),
      };
    }
    acc += segLen;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  return { ...last, heading: bearing(prev, last) };
}
