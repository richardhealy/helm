import { NextResponse } from "next/server";
import { assignDelivery } from "@/deliveries/orders/deliveries";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { vehicleId } = (await request.json().catch(() => ({}))) as {
    vehicleId?: string;
  };
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
  }
  await assignDelivery(id, vehicleId);
  return NextResponse.json({ ok: true });
}
