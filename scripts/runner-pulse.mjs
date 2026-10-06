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
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

let targets = configured;
if (!targets.length) {
  const repos = await gh(`/users/${owner}/repos?per_page=100&sort=pushed&direction=desc`);
  targets = repos.filter((repo) => !repo.archived).slice(0, 10).map((repo) => repo.full_name);
}

const fleet = [];
for (const full of targets) {
  try {
    const data = await gh(`/repos/${full}/actions/runners?per_page=100`);
    fleet.push({
      repository: full,
      visible: true,
      total: data.total_count,
      online: data.runners.filter((runner) => runner.status === "online").length,
      busy: data.runners.filter((runner) => runner.busy).length,
      runners: data.runners.map((runner) => ({
        id: runner.id,
        name: runner.name,
        os: runner.os,
        status: runner.status,
        busy: runner.busy,
        labels: runner.labels.map((label) => label.name),
      })),
    });
  } catch (error) {
    fleet.push({ repository: full, visible: false, error: String(error) });
  }
}

await writeFile("runner-pulse.json", JSON.stringify({
  schema: "aegis.runner-pulse.v1",
  generated_at: new Date().toISOString(),
  github_run_id: process.env.GITHUB_RUN_ID || null,
  fleet,
}, null, 2) + "\n");

console.log("AEGIS RUNNER PULSE: PASS");
