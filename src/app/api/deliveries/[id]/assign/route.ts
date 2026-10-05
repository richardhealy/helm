import { NextResponse } from "next/server";
import {
  assignDelivery,
  DeliveryNotFoundError,
  DeliveryStateError,
} from "@/deliveries/orders/deliveries";

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
  try {
    await assignDelivery(id, vehicleId);
  } catch (err) {
    if (err instanceof DeliveryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof DeliveryStateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
