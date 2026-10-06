import type { ActivityPoint, MonitorSnapshot, RepoTelemetry, RunState, WorkflowRun } from "@/lib/types";

const API = "https://api.github.com";

function token() {
  return process.env.MONITOR_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;

  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub ${response.status}: ${body.slice(0, 280)}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function stateOf(status: string, conclusion: string | null): RunState {
  if (status !== "completed") return status === "queued" ? "queued" : "running";
  if (conclusion === "success") return "success";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") return "failure";
  if (conclusion === "cancelled") return "cancelled";
  return "neutral";
}

function hourBucket(iso: string) {
  const d = new Date(iso);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function buildActivity(runs: WorkflowRun[]): ActivityPoint[] {
  const now = new Date();
  const buckets = new Map<string, ActivityPoint>();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 2 * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    const key = d.toISOString();
    buckets.set(key, {
      label: d.toLocaleTimeString("en-US", { hour: "numeric" }),
      success: 0,
      failure: 0,
      running: 0,
    });
  }
  for (const run of runs) {
    const runTime = new Date(run.createdAt).getTime();
    let closest: string | null = null;
    let delta = Number.POSITIVE_INFINITY;
    for (const key of buckets.keys()) {
      const diff = Math.abs(new Date(key).getTime() - runTime);
      if (diff < delta && diff <= 2 * 60 * 60 * 1000) {
        closest = key;
        delta = diff;
      }
    }
    if (!closest) continue;
    const point = buckets.get(closest)!;
    if (run.state === "success") point.success += 1;
    else if (run.state === "failure") point.failure += 1;
    else if (run.state === "running" || run.state === "queued") point.running += 1;
  }
  return [...buckets.values()];
}

export async function getMonitorSnapshot(): Promise<MonitorSnapshot> {
  const owner = process.env.MONITOR_OWNER || "SouthPaw302";
  const configured = (process.env.MONITOR_REPOS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const authMode = token() ? "token" : "public";
  const repoLimit = authMode === "token" ? 10 : 2;

  let repos: any[];
  if (configured.length) {
    repos = await Promise.all(configured.map((fullName) => gh<any>(`/repos/${fullName}`)));
  } else {
    repos = await gh<any[]>(`/users/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  }

  const targets = repos.filter((r) => !r.archived).slice(0, repoLimit);

  const telemetry = await Promise.all(
    targets.map(async (repo): Promise<RepoTelemetry> => {
      const fullName = repo.full_name;
      const [runsResponse, pulls, artifactsResponse, deployments, statusResponse, runnersResponse] = await Promise.all([
        gh<any>(`/repos/${fullName}/actions/runs?per_page=12`).catch(() => ({ workflow_runs: [] })),
        gh<any[]>(`/repos/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=8`).catch(() => []),
        gh<any>(`/repos/${fullName}/actions/artifacts?per_page=8`).catch(() => ({ artifacts: [] })),
        gh<any[]>(`/repos/${fullName}/deployments?per_page=8`).catch(() => []),
        gh<any>(`/repos/${fullName}/commits/${encodeURIComponent(repo.default_branch)}/status`).catch(() => ({ state: "unknown" })),
        authMode === "token"
          ? gh<any>(`/repos/${fullName}/actions/runners?per_page=100`).catch(() => null)
          : Promise.resolve(null),
      ]);

      const runs: WorkflowRun[] = (runsResponse.workflow_runs || []).map((run: any) => ({
        id: run.id,
        repo: fullName,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        state: stateOf(run.status, run.conclusion),
        branch: run.head_branch,
        sha: String(run.head_sha || "").slice(0, 8),
        event: run.event,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        url: run.html_url,
        runNumber: run.run_number,
      }));

      return {
        fullName,
        name: repo.name,
        description: repo.description,
        defaultBranch: repo.default_branch,
        pushedAt: repo.pushed_at,
        stars: repo.stargazers_count || 0,
        forks: repo.forks_count || 0,
        openIssues: repo.open_issues_count || 0,
        status: statusResponse.state || "unknown",
        runs,
        pulls: pulls.map((pr: any) => ({
          number: pr.number,
          repo: fullName,
          title: pr.title,
          state: pr.state,
          draft: Boolean(pr.draft),
          base: pr.base?.ref || "",
          head: pr.head?.ref || "",
          updatedAt: pr.updated_at,
          url: pr.html_url,
        })),
        artifacts: (artifactsResponse.artifacts || []).map((artifact: any) => ({
          id: artifact.id,
          repo: fullName,
          name: artifact.name,
          size: artifact.size_in_bytes || 0,
          expired: Boolean(artifact.expired),
          createdAt: artifact.created_at,
          expiresAt: artifact.expires_at,
          runId: artifact.workflow_run?.id || null,
        })),
        deployments: deployments.map((deployment: any) => ({
          id: deployment.id,
          repo: fullName,
          environment: deployment.environment || "deployment",
          ref: deployment.ref || "",
          createdAt: deployment.created_at,
          updatedAt: deployment.updated_at,
        })),
        runnerCount: runnersResponse?.total_count ?? null,
        busyRunners: runnersResponse?.runners?.filter((runner: any) => runner.busy).length ?? null,
      };
    }),
  );

  const allRuns = telemetry.flatMap((r) => r.runs);
  const successRuns = allRuns.filter((r) => r.state === "success").length;
  const failureRuns = allRuns.filter((r) => r.state === "failure").length;
  const runningRuns = allRuns.filter((r) => r.state === "running" || r.state === "queued").length;
  const openPrs = telemetry.reduce((sum, r) => sum + r.pulls.length, 0);
  const activeDeployments = telemetry.reduce((sum, r) => sum + r.deployments.length, 0);
  const denominator = Math.max(successRuns + failureRuns, 1);
  const health = Math.max(0, Math.min(100, Math.round((successRuns / denominator) * 100)));

  return {
    generatedAt: new Date().toISOString(),
    owner,
    authMode,
    repoLimit,
    summary: {
      repoCount: telemetry.length,
      successRuns,
      failureRuns,
      runningRuns,
      openPrs,
      activeDeployments,
      health,
    },
    statusCounts: [
      { name: "Success", value: successRuns },
      { name: "Failure", value: failureRuns },
      { name: "Running", value: runningRuns },
    ],
    activity: buildActivity(allRuns),
    repos: telemetry,
  };
}

export async function mutateRun(repo: string, runId: number, action: "rerun" | "rerun-failed" | "cancel") {
  const owner = process.env.MONITOR_OWNER || "SouthPaw302";
  if (!repo.startsWith(`${owner}/`)) throw new Error("Repository is outside the configured owner scope.");
  if (process.env.MONITOR_MUTATIONS_ENABLED !== "true") {
    throw new Error("Mutating controls are disabled. Set MONITOR_MUTATIONS_ENABLED=true.");
  }
  if (!token()) throw new Error("A GitHub token is required for workflow controls.");

  const suffix = action === "rerun-failed" ? "rerun-failed-jobs" : action;
  await gh<void>(`/repos/${repo}/actions/runs/${runId}/${suffix}`, { method: "POST" });
  return { ok: true };
}
