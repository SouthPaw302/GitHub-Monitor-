import { NextResponse } from "next/server";
import { mutateRun } from "@/lib/github";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const repo = String(body.repo || "");
    const runId = Number(body.runId);
    const action = body.action as "rerun" | "rerun-failed" | "cancel";

    if (!repo || !Number.isFinite(runId) || !["rerun", "rerun-failed", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Invalid workflow action request." }, { status: 400 });
    }

    const result = await mutateRun(repo, runId, action);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow action failed.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
