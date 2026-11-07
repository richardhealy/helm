import { NextResponse } from "next/server";
import {
  unassignDelivery,
  DeliveryNotFoundError,
  DeliveryStateError,
} from "@/deliveries/orders/deliveries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await unassignDelivery(id);
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
