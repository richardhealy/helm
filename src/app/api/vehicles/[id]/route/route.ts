import { NextResponse } from "next/server";
import { getActiveRoute } from "@/routing/routes/routes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const route = await getActiveRoute(id);
  if (!route) return NextResponse.json({ error: "no active route" }, { status: 404 });
  return NextResponse.json({ geometry: route.geometry });
}
