export function buildGeocodeUrl(address: string, token: string): string {
  const q = encodeURIComponent(address);
  return `https://api.mapbox.com/search/geocode/v6/forward?q=${q}&limit=1&access_token=${token}`;
}

export function parseGeocode(
  json: unknown,
): { lat: number; lng: number } | null {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const coords = (features[0] as { geometry?: { coordinates?: number[] } })
    ?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not set");
  const res = await fetch(buildGeocodeUrl(address, token));
  if (!res.ok) return null;
  return parseGeocode(await res.json());
}
