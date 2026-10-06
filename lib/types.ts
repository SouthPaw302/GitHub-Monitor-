export type RunState = "success" | "failure" | "cancelled" | "running" | "queued" | "neutral";

export type WorkflowRun = {
  id: number;
  repo: string;
  name: string;
  status: string;
  conclusion: string | null;
  state: RunState;
  branch: string | null;
  sha: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  runNumber: number;
};

export type PullRequest = {
  number: number;
  repo: string;
  title: string;
  state: string;
  draft: boolean;
  base: string;
  head: string;
  updatedAt: string;
  url: string;
};

export type Artifact = {
  id: number;
  repo: string;
  name: string;
  size: number;
  expired: boolean;
  createdAt: string;
  expiresAt: string | null;
  runId: number | null;
};

export type Deployment = {
  id: number;
  repo: string;
  environment: string;
  ref: string;
  createdAt: string;
  updatedAt: string;
};

export type RepoTelemetry = {
  fullName: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  pushedAt: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  status: string;
  runs: WorkflowRun[];
  pulls: PullRequest[];
  artifacts: Artifact[];
  deployments: Deployment[];
  runnerCount: number | null;
  busyRunners: number | null;
};

export type ActivityPoint = {
  label: string;
  success: number;
  failure: number;
  running: number;
};

export type MonitorSnapshot = {
  generatedAt: string;
  owner: string;
  authMode: "token" | "public";
  repoLimit: number;
  summary: {
    repoCount: number;
    successRuns: number;
    failureRuns: number;
    runningRuns: number;
    openPrs: number;
    activeDeployments: number;
    health: number;
  };
  statusCounts: Array<{ name: string; value: number }>;
  activity: ActivityPoint[];
  repos: RepoTelemetry[];
};
