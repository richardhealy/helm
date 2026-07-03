import { NextResponse } from "next/server";
import { unassignDelivery } from "@/deliveries/orders/deliveries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await unassignDelivery(id);
  return NextResponse.json({ ok: true });
}
