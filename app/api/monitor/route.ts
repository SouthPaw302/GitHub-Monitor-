import { NextResponse } from "next/server";
import { getMonitorSnapshot } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getMonitorSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monitor request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
