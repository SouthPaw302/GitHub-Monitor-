import { writeFile } from "node:fs/promises";

const owner = process.env.MONITOR_OWNER || "SouthPaw302";
const token = process.env.MONITOR_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const configured = (process.env.MONITOR_REPOS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

async function gh(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AEGIS-GitHub-Monitor",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${path}: ${body.slice(0, 220)}`);
  }
  return response.json();
}

let repos;
if (configured.length) {
  repos = await Promise.all(configured.map((name) => gh(`/repos/${name}`)));
} else {
  repos = await gh(`/users/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
}

const targets = repos.filter((repo) => !repo.archived).slice(0, token ? 12 : 3);
const rows = [];

for (const repo of targets) {
  const full = repo.full_name;
  const [runs, pulls, artifacts] = await Promise.all([
    gh(`/repos/${full}/actions/runs?per_page=10`).catch(() => ({ workflow_runs: [] })),
    gh(`/repos/${full}/pulls?state=open&per_page=10`).catch(() => []),
    gh(`/repos/${full}/actions/artifacts?per_page=10`).catch(() => ({ artifacts: [] })),
  ]);
  rows.push({
    repository: full,
    pushed_at: repo.pushed_at,
    default_branch: repo.default_branch,
    open_pull_requests: pulls.length,
    workflow_runs: (runs.workflow_runs || []).map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      branch: run.head_branch,
      sha: run.head_sha,
      created_at: run.created_at,
      updated_at: run.updated_at,
      html_url: run.html_url,
    })),
    artifacts: (artifacts.artifacts || []).map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      expired: artifact.expired,
      size_in_bytes: artifact.size_in_bytes,
      created_at: artifact.created_at,
      expires_at: artifact.expires_at,
    })),
  });
}

const document = {
  schema: "aegis.telemetry-snapshot.v1",
  owner,
  generated_at: new Date().toISOString(),
  github_run_id: process.env.GITHUB_RUN_ID || null,
  authenticated: Boolean(token),
  repositories: rows,
};

await writeFile("monitor-snapshot.json", JSON.stringify(document, null, 2) + "\n");
console.log(`AEGIS SNAPSHOT: PASS (${rows.length} repositories)`);
