import { NextRequest, NextResponse } from "next/server";
import { inspectRun } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const repo = request.nextUrl.searchParams.get("repo") || "";
    const runId = Number(request.nextUrl.searchParams.get("runId"));

    if (!repo || !Number.isFinite(runId)) {
      return NextResponse.json({ error: "repo and runId are required." }, { status: 400 });
    }

    const inspection = await inspectRun(repo, runId);
    return NextResponse.json(inspection, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run inspection failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
