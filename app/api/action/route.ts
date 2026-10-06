import { NextResponse } from "next/server";
import { auth, authConfigured, isAuthorizedGitHubLogin } from "@/auth";
import { mutateRun } from "@/lib/github";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!authConfigured) {
      return NextResponse.json(
        { error: "GitHub operator authentication is not configured." },
        { status: 503 },
      );
    }

    const session = await auth();
    const login = session?.user?.githubLogin;

    if (!login) {
      return NextResponse.json(
        { error: "GitHub sign-in is required for workflow controls." },
        { status: 401 },
      );
    }

    if (!isAuthorizedGitHubLogin(login)) {
      return NextResponse.json(
        { error: "This GitHub identity is not authorized for operator controls." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const repo = String(body.repo || "");
    const runId = Number(body.runId);
    const action = body.action as "rerun" | "rerun-failed" | "cancel";

    if (!repo || !Number.isFinite(runId) || !["rerun", "rerun-failed", "cancel"].includes(action)) {
      return NextResponse.json({ error: "Invalid workflow action request." }, { status: 400 });
    }

    const result = await mutateRun(repo, runId, action);
    return NextResponse.json({ ...result, operator: login });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow action failed.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
