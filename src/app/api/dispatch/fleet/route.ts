import { NextResponse } from "next/server";
import { dispatchFleet } from "@/routing/fleet/dispatch";

export async function POST() {
  const result = await dispatchFleet();
  if (result.assigned === 0) {
    return NextResponse.json(
      { error: "Nothing to dispatch (no unassigned deliveries or no vehicles with depots)" },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
}
