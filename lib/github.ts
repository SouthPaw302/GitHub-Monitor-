import type {
  ActivityPoint,
  MonitorSnapshot,
  RepoTelemetry,
  RunInspection,
  RunState,
  WorkflowRun,
} from "@/lib/types";

const API = "https://api.github.com";

let snapshotCache: { value: MonitorSnapshot; expiresAt: number } | null = null;

function token() {
  return process.env.MONITOR_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
}

function allowPrivate() {
  return process.env.MONITOR_INCLUDE_PRIVATE === "true";
}

function detailedLogsEnabled() {
  return process.env.MONITOR_LOGS_ENABLED === "true" && Boolean(token());
}

function mutationEnabled() {
  return process.env.MONITOR_MUTATIONS_ENABLED === "true" && Boolean(token());
}

function headers(extra?: HeadersInit) {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AEGIS-GitHub-Monitor",
  };
  const t = token();
  if (t) base.Authorization = `Bearer ${t}`;
  return { ...base, ...(extra || {}) };
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: headers(init?.headers),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub ${response.status}: ${body.slice(0, 280)}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function ghText(path: string): Promise<string> {
  const response = await fetch(`${API}${path}`, {
    headers: headers({ Accept: "application/vnd.github+json" }),
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}: log fetch failed`);
  return response.text();
}

function stateOf(status: string, conclusion: string | null): RunState {
  if (status !== "completed") return status === "queued" ? "queued" : "running";
  if (conclusion === "success") return "success";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") return "failure";
  if (conclusion === "cancelled") return "cancelled";
  return "neutral";
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
  const authMode = token() ? "token" : "public";
  const cacheSeconds = authMode === "token" ? 20 : 60;

  if (snapshotCache && snapshotCache.expiresAt > Date.now()) {
    return snapshotCache.value;
  }

  const owner = process.env.MONITOR_OWNER || "SouthPaw302";
  const configured = (process.env.MONITOR_REPOS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const repoLimit = authMode === "token" ? 12 : 2;

  let repos: any[];
  if (configured.length) {
    repos = await Promise.all(configured.map((fullName) => gh<any>(`/repos/${fullName}`)));
  } else {
    repos = await gh<any[]>(`/users/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  }

  const targets = repos
    .filter((repo) => !repo.archived)
    .filter((repo) => allowPrivate() || !repo.private)
    .slice(0, repoLimit);

  const telemetry = await Promise.all(
    targets.map(async (repo): Promise<RepoTelemetry> => {
      const fullName = repo.full_name;
      const [runsResponse, pulls, artifactsResponse, deployments, statusResponse, runnersResponse] = await Promise.all([
        gh<any>(`/repos/${fullName}/actions/runs?per_page=14`).catch(() => ({ workflow_runs: [] })),
        gh<any[]>(`/repos/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=10`).catch(() => []),
        gh<any>(`/repos/${fullName}/actions/artifacts?per_page=10`).catch(() => ({ artifacts: [] })),
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
          ref: String(deployment.ref || "").slice(0, 12),
          createdAt: deployment.created_at,
          updatedAt: deployment.updated_at,
        })),
        runnerCount: runnersResponse?.total_count ?? null,
        busyRunners: runnersResponse?.runners?.filter((runner: any) => runner.busy).length ?? null,
      };
    }),
  );

  const allRuns = telemetry.flatMap((repo) => repo.runs);
  const successRuns = allRuns.filter((run) => run.state === "success").length;
  const failureRuns = allRuns.filter((run) => run.state === "failure").length;
  const runningRuns = allRuns.filter((run) => run.state === "running" || run.state === "queued").length;
  const openPrs = telemetry.reduce((sum, repo) => sum + repo.pulls.length, 0);
  const activeDeployments = telemetry.reduce((sum, repo) => sum + repo.deployments.length, 0);
  const denominator = Math.max(successRuns + failureRuns, 1);
  const health = Math.max(0, Math.min(100, Math.round((successRuns / denominator) * 100)));

  const snapshot: MonitorSnapshot = {
    generatedAt: new Date().toISOString(),
    owner,
    authMode,
    repoLimit,
    capabilities: {
      mutations: mutationEnabled(),
      runnerTelemetry: authMode === "token",
      detailedLogs: detailedLogsEnabled(),
      privateRepositories: allowPrivate(),
      cacheSeconds,
    },
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

  snapshotCache = {
    value: snapshot,
    expiresAt: Date.now() + cacheSeconds * 1000,
  };

  return snapshot;
}

export async function inspectRun(repo: string, runId: number): Promise<RunInspection> {
  const owner = process.env.MONITOR_OWNER || "SouthPaw302";
  if (!repo.startsWith(`${owner}/`)) throw new Error("Repository is outside the configured owner scope.");

  const repoMeta = await gh<any>(`/repos/${repo}`);
  if (repoMeta.private && !allowPrivate()) {
    throw new Error("Private repository inspection is disabled by server policy.");
  }

  const jobsResponse = await gh<any>(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  const jobs = (jobsResponse.jobs || []).map((job: any) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    url: job.html_url || null,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    steps: (job.steps || []).map((step: any) => ({
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      startedAt: step.started_at || null,
      completedAt: step.completed_at || null,
    })),
  }));

  const failedJob = jobs.find((job: any) => job.conclusion === "failure");
  const failedStep = failedJob?.steps.find((step: any) => step.conclusion === "failure") || null;
  let lines: string[] = [];

  if (failedJob && detailedLogsEnabled()) {
    try {
      const logs = await ghText(`/repos/${repo}/actions/jobs/${failedJob.id}/logs`);
      lines = logs
        .split(/\r?\n/)
        .filter((line) => /##\[error\]|\berror\b|\bfatal\b|\bfailed\b|exception|traceback/i.test(line))
        .slice(-12)
        .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[^ ]+\s*/, "").slice(0, 420));
    } catch {
      lines = [];
    }
  }

  return {
    repo,
    runId,
    fetchedAt: new Date().toISOString(),
    logPolicy: detailedLogsEnabled() ? "enabled" : "disabled",
    jobs,
    failure: failedJob
      ? {
          job: failedJob.name,
          step: failedStep?.name || null,
          lines,
        }
      : null,
  };
}

export async function mutateRun(repo: string, runId: number, action: "rerun" | "rerun-failed" | "cancel") {
  const owner = process.env.MONITOR_OWNER || "SouthPaw302";
  if (!repo.startsWith(`${owner}/`)) throw new Error("Repository is outside the configured owner scope.");
  if (!mutationEnabled()) {
    throw new Error("Workflow controls are locked by server policy.");
  }

  const suffix = action === "rerun-failed" ? "rerun-failed-jobs" : action;
  await gh<void>(`/repos/${repo}/actions/runs/${runId}/${suffix}`, { method: "POST" });
  snapshotCache = null;
  return { ok: true };
}
