import { NextResponse } from "next/server";
import { positionPingInput } from "@/fleet/ingest/contract";
import { ingestPing } from "@/fleet/ingest/ingest";
import { VehicleNotFoundError } from "@/fleet/registry/vehicles";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = positionPingInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { id } = await ingestPing(parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof VehicleNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
