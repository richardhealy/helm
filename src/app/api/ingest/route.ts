import { NextResponse } from "next/server";
import { positionPingInput } from "@/fleet/ingest/contract";
import { ingestPing } from "@/fleet/ingest/ingest";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = positionPingInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { id } = await ingestPing(parsed.data);
  return NextResponse.json({ id }, { status: 201 });
}
