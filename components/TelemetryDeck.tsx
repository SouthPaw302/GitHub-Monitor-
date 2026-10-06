"use client";

import {
  Activity,
  AlertTriangle,
  Archive,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Cpu,
  ExternalLink,
  FileClock,
  GitBranch,
  Github,
  GitPullRequest,
  LayoutDashboard,
  LockKeyhole,
  Network,
  PauseCircle,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  Square,
  TerminalSquare,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  MonitorSnapshot,
  RepoTelemetry,
  RunInspection,
  WorkflowRun,
} from "@/lib/types";

type ViewId = "bridge" | "actions" | "repos" | "evidence" | "runners";
type OperatorIdentity = { login: string | null; name: string | null } | null;

const POLL_MS = 30_000;
const STATUS_COLORS = ["#73d9bc", "#ee6b56", "#dfba63"];

const VIEWS: Array<{ id: ViewId; label: string; short: string; icon: typeof LayoutDashboard }> = [
  { id: "bridge", label: "Bridge", short: "Bridge", icon: LayoutDashboard },
  { id: "actions", label: "Actions", short: "Runs", icon: Workflow },
  { id: "repos", label: "Repositories", short: "Repos", icon: GitBranch },
  { id: "evidence", label: "Evidence", short: "Proof", icon: Archive },
  { id: "runners", label: "Runners", short: "Runners", icon: Cpu },
];

function ago(iso?: string | null) {
  if (!iso) return "—";
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return `${Math.max(1, Math.floor(delta / 1000))}s`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function fmtBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function stateLabel(run: WorkflowRun) {
  if (run.state === "running") return "RUNNING";
  if (run.state === "queued") return "QUEUED";
  return (run.conclusion || run.state).toUpperCase();
}

function repoShort(fullName: string) {
  return fullName.replace(/^SouthPaw302\//, "");
}

function PanelTitle({
  eyebrow,
  title,
  icon,
  trailing,
}: {
  eyebrow: string;
  title: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <div className="panel-head-tools">{trailing}{icon}</div>
    </div>
  );
}

function Gauge({
  value,
  label,
  note,
}: {
  value: number;
  label: string;
  note: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const circumference = 251.2;
  const offset = circumference - (circumference * clamped) / 100;
  return (
    <div className="pressure-gauge">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="pressure-track" cx="50" cy="50" r="40" />
        <circle
          className="pressure-value"
          cx="50"
          cy="50"
          r="40"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pressure-readout">
        <strong>{clamped}%</strong>
        <span>{label}</span>
      </div>
      <small>{note}</small>
    </div>
  );
}

function SignalChip({
  tone,
  label,
  value,
}: {
  tone: "mint" | "red" | "amber" | "blue";
  label: string;
  value: string | number;
}) {
  return (
    <div className={`signal-chip signal-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StateBadge({ state }: { state: WorkflowRun["state"] }) {
  return <span className={`state-badge state-${state}`}>{state.toUpperCase()}</span>;
}

function RunAction({
  run,
  enabled,
  busy,
  onAction,
}: {
  run: WorkflowRun;
  enabled: boolean;
  busy: boolean;
  onAction: (run: WorkflowRun, action: "rerun" | "rerun-failed" | "cancel") => Promise<void>;
}) {
  if (run.state === "failure") {
    return (
      <button
        className="machine-button"
        disabled={!enabled || busy}
        title={!enabled ? "Authorized GitHub operator session and server-side mutations are required." : "Rerun failed jobs"}
        onClick={() => onAction(run, "rerun-failed")}
      >
        <RotateCcw size={14} />
        {busy ? "Sending" : enabled ? "Rerun failed" : "Locked"}
      </button>
    );
  }
  if (run.state === "running" || run.state === "queued") {
    return (
      <button
        className="machine-button danger"
        disabled={!enabled || busy}
        title={!enabled ? "Authorized GitHub operator session and server-side mutations are required." : "Cancel workflow"}
        onClick={() => onAction(run, "cancel")}
      >
        <Square size={13} />
        {busy ? "Sending" : enabled ? "Cancel" : "Locked"}
      </button>
    );
  }
  return null;
}

function Capability({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className={`capability ${ok ? "cap-on" : "cap-off"}`}>
      <div className="capability-lamp" />
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function RepoPlate({
  repo,
  active,
  onOpen,
}: {
  repo: RepoTelemetry;
  active: boolean;
  onOpen: () => void;
}) {
  const failures = repo.runs.filter((run) => run.state === "failure").length;
  const live = repo.runs.filter((run) => run.state === "running" || run.state === "queued").length;
  const healthy = !failures;
  return (
    <button className={`repo-plate ${active ? "active" : ""}`} onClick={onOpen}>
      <div className="repo-plate-top">
        <div className={`status-lamp ${healthy ? "lamp-ok" : "lamp-fault"} ${live ? "lamp-live" : ""}`} />
        <strong>{repo.name}</strong>
        <ChevronRight size={16} />
      </div>
      <div className="repo-plate-meta">
        <span>{repo.defaultBranch}</span>
        <span>{ago(repo.pushedAt)} ago</span>
      </div>
      <div className="repo-plate-signals">
        <i>{repo.runs.length} runs</i>
        <i>{failures} faults</i>
        <i>{repo.pulls.length} PRs</i>
      </div>
    </button>
  );
}

export default function TelemetryDeck({
  authConfigured,
  operator,
}: {
  authConfigured: boolean;
  operator: OperatorIdentity;
}) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [view, setView] = useState<ViewId>("bridge");
  const [selectedRepo, setSelectedRepo] = useState("ALL");
  const [query, setQuery] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [inspectionBusy, setInspectionBusy] = useState<string | null>(null);
  const [inspection, setInspection] = useState<RunInspection | null>(null);
  const [commandLog, setCommandLog] = useState("Command bus standing by.");

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/monitor", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Telemetry request failed.");
      setSnapshot(body);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telemetry request failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("aegis-view") as ViewId | null;
    if (stored && VIEWS.some((item) => item.id === stored)) setView(stored);
    refresh();
  }, [refresh]);

  useEffect(() => {
    window.localStorage.setItem("aegis-view", view);
  }, [view]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [auto, refresh]);

  const scopedRepos = useMemo(() => {
    if (!snapshot) return [];
    return selectedRepo === "ALL"
      ? snapshot.repos
      : snapshot.repos.filter((repo) => repo.fullName === selectedRepo);
  }, [selectedRepo, snapshot]);

  const allRuns = useMemo(
    () => scopedRepos.flatMap((repo) => repo.runs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [scopedRepos],
  );
  const allPulls = useMemo(
    () => scopedRepos.flatMap((repo) => repo.pulls).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [scopedRepos],
  );
  const allArtifacts = useMemo(
    () => scopedRepos.flatMap((repo) => repo.artifacts).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [scopedRepos],
  );
  const allDeployments = useMemo(
    () => scopedRepos.flatMap((repo) => repo.deployments).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [scopedRepos],
  );

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allRuns;
    return allRuns.filter((run) =>
      [run.name, run.repo, run.branch || "", run.sha, run.event, stateLabel(run)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [allRuns, query]);

  const liveCount = allRuns.filter((run) => run.state === "running" || run.state === "queued").length;
  const failureCount = allRuns.filter((run) => run.state === "failure").length;
  const successCount = allRuns.filter((run) => run.state === "success").length;
  const localHealth = Math.round((successCount / Math.max(successCount + failureCount, 1)) * 100);

  const repoChart = scopedRepos.map((repo) => ({
    name: repo.name.replace("GitHub-", "GH-").slice(0, 15),
    workflows: repo.runs.length,
    faults: repo.runs.filter((run) => run.state === "failure").length,
    prs: repo.pulls.length,
  }));

  const canMutate = Boolean(operator && snapshot?.capabilities.mutations);

  const onAction = async (
    run: WorkflowRun,
    action: "rerun" | "rerun-failed" | "cancel",
  ) => {
    const key = `${run.repo}:${run.id}`;
    setActionBusy(key);
    setCommandLog(`Transmitting ${action} to ${repoShort(run.repo)} / run #${run.runNumber}.`);
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: run.repo, runId: run.id, action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Action rejected.");
      setCommandLog(`Command accepted by GitHub for ${repoShort(run.repo)} / #${run.runNumber}.`);
      window.setTimeout(refresh, 1300);
    } catch (cause) {
      setCommandLog(cause instanceof Error ? cause.message : "Action failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const inspectRun = async (run: WorkflowRun) => {
    const key = `${run.repo}:${run.id}`;
    setInspectionBusy(key);
    setInspection(null);
    setCommandLog(`Inspecting GitHub jobs for ${repoShort(run.repo)} / #${run.runNumber}.`);
    try {
      const params = new URLSearchParams({ repo: run.repo, runId: String(run.id) });
      const response = await fetch(`/api/run?${params.toString()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Inspection failed.");
      setInspection(body);
      setCommandLog(`Inspection loaded for ${repoShort(run.repo)} / #${run.runNumber}.`);
    } catch (cause) {
      setCommandLog(cause instanceof Error ? cause.message : "Inspection failed.");
    } finally {
      setInspectionBusy(null);
    }
  };

  const attentionRuns = allRuns
    .filter((run) => run.state === "failure" || run.state === "running" || run.state === "queued")
    .slice(0, 6);

  return (
    <main className="aegis-shell">
      <div className="ambient-grid" />

      <header className="masthead">
        <div className="brand-block">
          <div className="brand-gear"><Settings size={28} /></div>
          <div>
            <p className="eyebrow">SOUTHPAW302 // GITHUB OPERATIONS</p>
            <h1>AEGIS <span>Command Works</span></h1>
          </div>
        </div>

        <div className="masthead-tools">
          <div className={`link-status ${error ? "link-fault" : ""}`}>
            <Radio size={14} />
            {error ? "DEGRADED" : "LIVE"}
          </div>

          <select
            value={selectedRepo}
            onChange={(event) => setSelectedRepo(event.target.value)}
            aria-label="Repository scope"
          >
            <option value="ALL">All monitored repos</option>
            {snapshot?.repos.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>{repo.name}</option>
            ))}
          </select>

          <button className="square-button" onClick={refresh} disabled={loading} title="Refresh">
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>

          <button className={`auto-switch ${auto ? "active" : ""}`} onClick={() => setAuto((value) => !value)}>
            {auto ? <Zap size={15} /> : <PauseCircle size={15} />}
            {auto ? "30s" : "Paused"}
          </button>

          {authConfigured ? (
            operator ? (
              <div className="operator-chip">
                <Github size={16} />
                <div>
                  <strong>@{operator.login || operator.name || "operator"}</strong>
                  <span>OPERATOR</span>
                </div>
                <a href="/signout">Exit</a>
              </div>
            ) : (
              <a className="github-signin" href="/signin"><Github size={16} /> Sign in</a>
            )
          ) : (
            <span className="oauth-pending"><LockKeyhole size={14} /> OAuth pending</span>
          )}
        </div>
      </header>

      <div className="workspace">
        <nav className="mode-rail" aria-label="Dashboard views">
          <div className="rail-plaque">MODES</div>
          {VIEWS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="rail-spacer" />
          <div className="rail-status">
            <span className={snapshot?.authMode === "token" ? "ok" : ""} />
            <small>{snapshot?.authMode === "token" ? "API AUTH" : "PUBLIC"}</small>
          </div>
        </nav>

        <section className="view-stage">
          {error && (
            <div className="alarm-banner">
              <AlertTriangle size={18} />
              <div><strong>Telemetry fault</strong><span>{error}</span></div>
            </div>
          )}

          {view === "bridge" && (
            <>
              <section className="bridge-hero">
                <div className="machine-panel health-panel">
                  <PanelTitle eyebrow="CORE INTEGRITY" title="System Pressure" icon={<CircleGauge size={20} />} />
                  <Gauge
                    value={selectedRepo === "ALL" ? snapshot?.summary.health ?? 0 : localHealth}
                    label="HEALTH"
                    note={failureCount ? `${failureCount} abnormal workflows` : "No sampled workflow faults"}
                  />
                  <div className="gauge-subgrid">
                    <div><span>Repos</span><strong>{scopedRepos.length}</strong></div>
                    <div><span>Cache</span><strong>{snapshot?.capabilities.cacheSeconds ?? "—"}s</strong></div>
                  </div>
                </div>

                <div className="signal-bank">
                  <SignalChip tone="blue" label="Live runs" value={liveCount} />
                  <SignalChip tone="red" label="Faults" value={failureCount} />
                  <SignalChip tone="amber" label="Open PRs" value={allPulls.length} />
                  <SignalChip tone="mint" label="Artifacts" value={allArtifacts.filter((item) => !item.expired).length} />
                </div>

                <div className="machine-panel attention-panel">
                  <PanelTitle
                    eyebrow="OPERATOR ATTENTION"
                    title="Abnormal & Live"
                    icon={<AlertTriangle size={19} />}
                    trailing={<span className="count-plate">{attentionRuns.length}</span>}
                  />
                  <div className="attention-list">
                    {attentionRuns.map((run) => (
                      <button
                        key={`${run.repo}-${run.id}`}
                        onClick={() => { setView("actions"); setQuery(run.sha); }}
                      >
                        <span className={`status-lamp lamp-${run.state}`} />
                        <div>
                          <strong>{run.name}</strong>
                          <small>{repoShort(run.repo)} · {run.branch || "detached"} · {run.sha}</small>
                        </div>
                        <StateBadge state={run.state} />
                      </button>
                    ))}
                    {!attentionRuns.length && (
                      <div className="quiet-state"><CheckCircle2 size={20} /> No active abnormalities.</div>
                    )}
                  </div>
                </div>
              </section>

              <section className="bridge-grid">
                <div className="machine-panel activity-panel">
                  <PanelTitle eyebrow="24 HOUR TREND" title="Workflow Signal" icon={<Activity size={19} />} />
                  <div className="chart chart-large">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={snapshot?.activity || []}>
                        <defs>
                          <linearGradient id="okFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#73d9bc" stopOpacity={0.36} />
                            <stop offset="95%" stopColor="#73d9bc" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="faultFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ee6b56" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="#ee6b56" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#574331" strokeDasharray="3 6" opacity={0.28} />
                        <XAxis dataKey="label" stroke="#8f7b68" tickLine={false} axisLine={false} />
                        <YAxis stroke="#8f7b68" tickLine={false} axisLine={false} width={28} />
                        <Tooltip contentStyle={{ background: "#11100d", border: "1px solid #765334", color: "#eadcc5" }} />
                        <Area type="monotone" dataKey="success" stroke="#73d9bc" fill="url(#okFill)" strokeWidth={2} />
                        <Area type="monotone" dataKey="failure" stroke="#ee6b56" fill="url(#faultFill)" strokeWidth={2} />
                        <Area type="monotone" dataKey="running" stroke="#dfba63" fillOpacity={0} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="machine-panel balance-panel">
                  <PanelTitle eyebrow="RUN BALANCE" title="Signal State" icon={<Radio size={18} />} />
                  <div className="donut">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={snapshot?.statusCounts || []} dataKey="value" innerRadius={54} outerRadius={72} paddingAngle={4}>
                          {(snapshot?.statusCounts || []).map((item, index) => (
                            <Cell key={item.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: "#11100d", border: "1px solid #765334", color: "#eadcc5" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="legend-list">
                      {(snapshot?.statusCounts || []).map((item, index) => (
                        <div key={item.name}>
                          <i style={{ background: STATUS_COLORS[index % STATUS_COLORS.length] }} />
                          <span>{item.name}</span>
                          <strong>{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="machine-panel fleet-panel">
                <PanelTitle eyebrow="FLEET OVERVIEW" title="Repository Plates" icon={<Network size={19} />} />
                <div className="repo-fleet">
                  {scopedRepos.map((repo) => (
                    <RepoPlate
                      key={repo.fullName}
                      repo={repo}
                      active={selectedRepo === repo.fullName}
                      onOpen={() => { setSelectedRepo(repo.fullName); setView("repos"); }}
                    />
                  ))}
                </div>
              </section>
            </>
          )}

          {view === "actions" && (
            <>
              <section className="view-toolbar">
                <div>
                  <p className="eyebrow">ACTION ENGINE</p>
                  <h2>Workflow Operations</h2>
                </div>
                <label className="search-box">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search workflow, branch, SHA…"
                    aria-label="Search workflows"
                  />
                  {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
                </label>
              </section>

              <section className="machine-panel run-table-panel">
                <div className="run-table">
                  {filteredRuns.map((run) => {
                    const key = `${run.repo}:${run.id}`;
                    return (
                      <article className="run-record" key={key}>
                        <div className={`status-lamp lamp-${run.state}`} />
                        <div className="run-primary">
                          <strong>{run.name}</strong>
                          <span>{repoShort(run.repo)} · {run.branch || "detached"} · {run.sha}</span>
                        </div>
                        <StateBadge state={run.state} />
                        <div className="run-time">
                          <strong>#{run.runNumber}</strong>
                          <span>{ago(run.updatedAt)} ago</span>
                        </div>
                        <div className="run-tools">
                          {(run.state === "failure" || run.state === "running" || run.state === "queued") && (
                            <button
                              className="machine-button secondary"
                              disabled={inspectionBusy === key}
                              onClick={() => inspectRun(run)}
                            >
                              <TerminalSquare size={14} />
                              {inspectionBusy === key ? "Reading" : "Inspect"}
                            </button>
                          )}
                          <RunAction
                            run={run}
                            enabled={canMutate}
                            busy={actionBusy === key}
                            onAction={onAction}
                          />
                          <a href={run.url} target="_blank" rel="noreferrer" className="external-button" title="Open in GitHub">
                            <ExternalLink size={15} />
                          </a>
                        </div>
                      </article>
                    );
                  })}
                  {!filteredRuns.length && <div className="quiet-state">No workflow runs match the current filters.</div>}
                </div>
              </section>

              {inspection && (
                <section className="machine-panel inspector-panel">
                  <PanelTitle
                    eyebrow="EVIDENCE INSPECTOR"
                    title={`${repoShort(inspection.repo)} / run ${inspection.runId}`}
                    icon={<TerminalSquare size={19} />}
                    trailing={<button className="close-inspector" onClick={() => setInspection(null)}><X size={16} /></button>}
                  />
                  {inspection.failure && (
                    <div className="failure-summary">
                      <AlertTriangle size={18} />
                      <div>
                        <strong>{inspection.failure.job}</strong>
                        <span>{inspection.failure.step || "Failed job"}</span>
                      </div>
                    </div>
                  )}
                  <div className="job-grid">
                    {inspection.jobs.map((job) => (
                      <div className="job-card" key={job.id}>
                        <div className="job-card-head">
                          <strong>{job.name}</strong>
                          <span>{job.conclusion || job.status}</span>
                        </div>
                        <div className="step-list">
                          {job.steps.map((step) => (
                            <div key={step.number} className={step.conclusion === "failure" ? "failed-step" : ""}>
                              <span>{step.number}</span>
                              <strong>{step.name}</strong>
                              <small>{step.conclusion || step.status}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="log-evidence">
                    <strong>Failure evidence</strong>
                    {inspection.failure?.lines.length ? (
                      <pre>{inspection.failure.lines.join("\n")}</pre>
                    ) : (
                      <p>
                        {inspection.logPolicy === "enabled"
                          ? "No filtered error lines were returned for the failed job."
                          : "Detailed log extraction is disabled by server policy; job and step evidence remains available."}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {view === "repos" && (
            <>
              <section className="view-toolbar">
                <div>
                  <p className="eyebrow">REPOSITORY WORKS</p>
                  <h2>Fleet Detail</h2>
                </div>
                <span className="count-plate">{scopedRepos.length} repositories</span>
              </section>

              <section className="repo-detail-grid">
                {scopedRepos.map((repo) => {
                  const faults = repo.runs.filter((run) => run.state === "failure").length;
                  const running = repo.runs.filter((run) => run.state === "running" || run.state === "queued").length;
                  return (
                    <article className="machine-panel repo-detail" key={repo.fullName}>
                      <div className="repo-detail-head">
                        <div>
                          <p className="eyebrow">{repo.status.toUpperCase()} CHECK STATUS</p>
                          <h3>{repo.name}</h3>
                          <span>{repo.fullName}</span>
                        </div>
                        <div className={`mechanical-orb ${faults ? "fault" : running ? "live" : "ok"}`} />
                      </div>
                      <div className="repo-readouts">
                        <div><span>Default branch</span><strong>{repo.defaultBranch}</strong></div>
                        <div><span>Last push</span><strong>{ago(repo.pushedAt)} ago</strong></div>
                        <div><span>Workflow sample</span><strong>{repo.runs.length}</strong></div>
                        <div><span>Faults</span><strong>{faults}</strong></div>
                        <div><span>Open PRs</span><strong>{repo.pulls.length}</strong></div>
                        <div><span>Deployments</span><strong>{repo.deployments.length}</strong></div>
                      </div>
                      <div className="mini-bars">
                        <div style={{ width: `${Math.min(100, repo.runs.length * 7)}%` }} />
                      </div>
                      <button
                        className="machine-button secondary full"
                        onClick={() => { setSelectedRepo(repo.fullName); setView("actions"); setQuery(""); }}
                      >
                        <Workflow size={14} /> Open workflow stream
                      </button>
                    </article>
                  );
                })}
              </section>

              <section className="machine-panel load-panel">
                <PanelTitle eyebrow="FLEET LOAD" title="Operational Volume" icon={<ServerCog size={19} />} />
                <div className="chart chart-large">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={repoChart}>
                      <CartesianGrid stroke="#574331" strokeDasharray="3 6" opacity={0.28} />
                      <XAxis dataKey="name" stroke="#8f7b68" tickLine={false} axisLine={false} />
                      <YAxis stroke="#8f7b68" tickLine={false} axisLine={false} width={28} />
                      <Tooltip contentStyle={{ background: "#11100d", border: "1px solid #765334", color: "#eadcc5" }} />
                      <Bar dataKey="workflows" fill="#b8753b" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="prs" fill="#638fa0" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="faults" fill="#c85d4b" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}

          {view === "evidence" && (
            <>
              <section className="view-toolbar">
                <div>
                  <p className="eyebrow">DURABLE PROOF</p>
                  <h2>Evidence Vault</h2>
                </div>
                <span className="count-plate">{allArtifacts.length + allDeployments.length + allPulls.length} records</span>
              </section>

              <section className="evidence-grid">
                <div className="machine-panel">
                  <PanelTitle eyebrow="ARTIFACTS" title="Build Evidence" icon={<Box size={18} />} />
                  <div className="evidence-list">
                    {allArtifacts.map((artifact) => (
                      <div className="evidence-row" key={`${artifact.repo}-${artifact.id}`}>
                        <Box size={15} />
                        <div>
                          <strong>{artifact.name}</strong>
                          <span>{repoShort(artifact.repo)} · {fmtBytes(artifact.size)}</span>
                        </div>
                        <small className={artifact.expired ? "expired" : ""}>
                          {artifact.expired ? "expired" : `${ago(artifact.createdAt)} ago`}
                        </small>
                      </div>
                    ))}
                    {!allArtifacts.length && <div className="quiet-state">No artifacts in sample.</div>}
                  </div>
                </div>

                <div className="machine-panel">
                  <PanelTitle eyebrow="DEPLOYMENTS" title="Release Evidence" icon={<Zap size={18} />} />
                  <div className="evidence-list">
                    {allDeployments.map((deployment) => (
                      <div className="evidence-row" key={`${deployment.repo}-${deployment.id}`}>
                        <Zap size={15} />
                        <div>
                          <strong>{deployment.environment}</strong>
                          <span>{repoShort(deployment.repo)} · {deployment.ref}</span>
                        </div>
                        <small>{ago(deployment.updatedAt)} ago</small>
                      </div>
                    ))}
                    {!allDeployments.length && <div className="quiet-state">No deployments in sample.</div>}
                  </div>
                </div>

                <div className="machine-panel">
                  <PanelTitle eyebrow="PULL REQUESTS" title="Merge Evidence" icon={<GitPullRequest size={18} />} />
                  <div className="evidence-list">
                    {allPulls.map((pr) => (
                      <a className="evidence-row" key={`${pr.repo}-${pr.number}`} href={pr.url} target="_blank" rel="noreferrer">
                        <GitPullRequest size={15} />
                        <div>
                          <strong>#{pr.number} {pr.title}</strong>
                          <span>{repoShort(pr.repo)} · {pr.head} → {pr.base}</span>
                        </div>
                        <small>{ago(pr.updatedAt)} ago</small>
                      </a>
                    ))}
                    {!allPulls.length && <div className="quiet-state">No open pull requests.</div>}
                  </div>
                </div>
              </section>
            </>
          )}

          {view === "runners" && (
            <>
              <section className="view-toolbar">
                <div>
                  <p className="eyebrow">COMPUTE & CAPABILITY</p>
                  <h2>Runner Engine Room</h2>
                </div>
                <span className="count-plate">{snapshot?.authMode === "token" ? "authenticated" : "public fallback"}</span>
              </section>

              <section className="runner-layout">
                <div className="machine-panel">
                  <PanelTitle eyebrow="RUNNER TURBINES" title="Compute Pressure" icon={<Cpu size={19} />} />
                  <div className="runner-grid">
                    {scopedRepos.map((repo) => {
                      const known = repo.runnerCount !== null;
                      const pct = known && repo.runnerCount
                        ? Math.round(((repo.busyRunners || 0) / repo.runnerCount) * 100)
                        : 0;
                      return (
                        <div className="runner-unit" key={repo.fullName}>
                          <div className={`turbine ${pct ? "spinning" : ""}`}><Settings size={29} /></div>
                          <div>
                            <strong>{repo.name}</strong>
                            <span>{known ? `${repo.busyRunners || 0}/${repo.runnerCount} busy` : "runner telemetry unavailable"}</span>
                          </div>
                          <div className="pressure-bar"><i style={{ width: `${pct}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="machine-panel capability-panel">
                  <PanelTitle eyebrow="SYSTEM CAPABILITIES" title="Authority Matrix" icon={<ShieldCheck size={19} />} />
                  <div className="capability-list">
                    <Capability ok={snapshot?.authMode === "token"} label="GitHub API authentication" detail={snapshot?.authMode === "token" ? "Server credential active" : "Public API only"} />
                    <Capability ok={Boolean(snapshot?.capabilities.runnerTelemetry)} label="Runner telemetry" detail="Repository runner visibility" />
                    <Capability ok={Boolean(snapshot?.capabilities.detailedLogs)} label="Detailed log extraction" detail="Filtered failure evidence" />
                    <Capability ok={Boolean(snapshot?.capabilities.mutations)} label="Workflow mutations" detail="Rerun / cancel server authority" />
                    <Capability ok={Boolean(operator)} label="Operator identity" detail={operator ? `@${operator.login || operator.name}` : "No signed-in operator"} />
                    <Capability ok={Boolean(snapshot?.capabilities.privateRepositories)} label="Private repo inclusion" detail="Server policy switch" />
                  </div>
                </div>

                <div className="machine-panel console-panel">
                  <PanelTitle eyebrow="COMMAND BUS" title="Operator Console" icon={<TerminalSquare size={19} />} />
                  <div className="console">
                    <span>AEGIS&gt;</span>
                    <p>{commandLog}</p>
                  </div>
                  <div className="console-foot">
                    <span><FileClock size={13} /> sampled {snapshot ? ago(snapshot.generatedAt) : "—"} ago</span>
                    <span><ShieldCheck size={13} /> {operator ? "operator verified" : "read-only observer"}</span>
                  </div>
                </div>
              </section>
            </>
          )}
        </section>
      </div>

      <nav className="mobile-dock" aria-label="Mobile dashboard views">
        {VIEWS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              <Icon size={18} />
              <span>{item.short}</span>
            </button>
          );
        })}
      </nav>
    </main>
  );
}
