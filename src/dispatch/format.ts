export function formatEta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function fleetStatusLine(vehicles: { status: string }[]): string {
  const enRoute = vehicles.filter((v) => v.status === "en_route").length;
  return `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} · ${enRoute} en route`;
}
