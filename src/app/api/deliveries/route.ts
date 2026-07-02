import { NextResponse } from "next/server";
import { z } from "zod";
import { createDelivery } from "@/deliveries/orders/deliveries";

const body = z.object({ address: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  try {
    const delivery = await createDelivery(parsed.data);
    return NextResponse.json(delivery, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Could not geocode address" },
      { status: 400 },
    );
  }
}
