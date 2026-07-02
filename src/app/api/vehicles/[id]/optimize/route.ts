import { NextResponse } from "next/server";
import { optimizeRouteForVehicle } from "@/routing/routes/routes";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await optimizeRouteForVehicle(id);
  if (!result) {
    return NextResponse.json(
      { error: "No depot or no assigned deliveries" },
      { status: 409 },
    );
  }
  return NextResponse.json(result, { status: 200 });
}
