import { NextResponse } from "next/server";
import { getDispatchBoard } from "@/dispatch/board";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await getDispatchBoard();
  return NextResponse.json(board);
}
