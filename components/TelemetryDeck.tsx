"use client";

import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Cpu,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Github,
  LockKeyhole,
  PauseCircle,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Square,
  Workflow,
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
import type { MonitorSnapshot, RepoTelemetry, WorkflowRun } from "@/lib/types";

const STATUS_COLORS = ["#61e8bf", "#ff715b", "#f3c86b"];
const POLL_MS = 30_000;

function ago(iso?: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function stateLabel(run: WorkflowRun) {
  if (run.state === "running") return "RUNNING";
  if (run.state === "queued") return "QUEUED";
  return (run.conclusion || run.state).toUpperCase();
}

function GaugeRing({ value, label, detail }: { value: number; label: string; detail: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const dash = 251.2;
  const offset = dash - (dash * clamped) / 100;
  return (
    <div className="gauge-shell">
      <svg className="gauge-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="gauge-track" cx="50" cy="50" r="40" />
        <circle
          className="gauge-value"
          cx="50"
          cy="50"
          r="40"
          strokeDasharray={dash}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="gauge-core">
        <strong>{clamped}%</strong>
        <span>{label}</span>
      </div>
      <small>{detail}</small>
    </div>
  );
}

function Metric({
  icon,
  value,
  label,
  tone = "copper",
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  tone?: "copper" | "mint" | "red" | "blue";
}) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function RunControls({
  run,
  onAction,
  busy,
  enabled,
}: {
  run: WorkflowRun;
  onAction: (run: WorkflowRun, action: "rerun" | "rerun-failed" | "cancel") => Promise<void>;
  busy: string | null;
  enabled: boolean;
}) {
  const key = `${run.repo}:${run.id}`;
  const isBusy = busy === key;
  if (run.state === "failure") {
    return (
      <button
        className="control-button"
        disabled={isBusy || !enabled}
        title={!enabled ? "Authorized GitHub sign-in and server-side mutations are required." : "Rerun failed jobs"}
        onClick={() => onAction(run, "rerun-failed")}
      >
        <RotateCcw size={14} /> {!enabled ? "Locked" : isBusy ? "Sending…" : "Rerun failed"}
      </button>
    );
  }
  if (run.state === "running" || run.state === "queued") {
    return (
      <button
        className="control-button danger"
        disabled={isBusy || !enabled}
        title={!enabled ? "Authorized GitHub sign-in and server-side mutations are required." : "Cancel workflow"}
        onClick={() => onAction(run, "cancel")}
      >
        <Square size={13} /> {!enabled ? "Locked" : isBusy ? "Sending…" : "Cancel"}
      </button>
    );
  }
  return null;
}

function RepoNode({ repo }: { repo: RepoTelemetry }) {
  const failures = repo.runs.filter((run) => run.state === "failure").length;
  const running = repo.runs.filter((run) => run.state === "running" || run.state === "queued").length;
  const state = failures ? "fault" : running ? "active" : "nominal";
  return (
    <div className={`repo-node ${state}`}>
      <div className="node-orbit">
        <div className="node-core" />
      </div>
      <strong>{repo.name}</strong>
      <span>{failures ? `${failures} faults` : running ? `${running} live` : "nominal"}</span>
    </div>
  );
}

type OperatorIdentity = { login: string | null; name: string | null } | null;

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
  const [selectedRepo, setSelectedRepo] = useState("ALL");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [commandLog, setCommandLog] = useState("Command bus standing by.");

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/monitor", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Telemetry request failed.");
      setSnapshot(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Telemetry request failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [auto, refresh]);

  const repos = useMemo(() => {
    if (!snapshot) return [];
    return selectedRepo === "ALL"
      ? snapshot.repos
      : snapshot.repos.filter((repo) => repo.fullName === selectedRepo);
  }, [selectedRepo, snapshot]);

  const runs = useMemo(() => repos.flatMap((repo) => repo.runs).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [repos]);
  const pulls = useMemo(() => repos.flatMap((repo) => repo.pulls).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [repos]);
  const artifacts = useMemo(() => repos.flatMap((repo) => repo.artifacts).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [repos]);

  const liveCount = runs.filter((run) => run.state === "running" || run.state === "queued").length;
  const failureCount = runs.filter((run) => run.state === "failure").length;
  const successCount = runs.filter((run) => run.state === "success").length;
  const localHealth = Math.round((successCount / Math.max(successCount + failureCount, 1)) * 100);

  const repoChart = repos.map((repo) => ({
    name: repo.name.replace("GitHub-", "GH-").slice(0, 16),
    workflows: repo.runs.length,
    prs: repo.pulls.length,
    faults: repo.runs.filter((run) => run.state === "failure").length,
  }));

  const onAction = async (run: WorkflowRun, action: "rerun" | "rerun-failed" | "cancel") => {
    const key = `${run.repo}:${run.id}`;
    setActionBusy(key);
    setCommandLog(`Transmitting ${action} command to ${run.repo} / run #${run.runNumber}…`);
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: run.repo, runId: run.id, action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Action rejected.");
      setCommandLog(`Command accepted: ${action} on ${run.repo} / run #${run.runNumber}.`);
      window.setTimeout(refresh, 1400);
    } catch (err) {
      setCommandLog(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <main className="command-deck">
      <div className="atmosphere" />
      <header className="top-rail">
        <div className="brand-cluster">
          <div className="cog-emblem"><Settings size={34} /></div>
          <div>
            <p className="eyebrow">SOUTHPAW302 // OPERATIONS NETWORK</p>
            <h1>AEGIS <span>GitHub Monitor</span></h1>
          </div>
        </div>
        <div className="live-cluster">
          <div className={`live-pill ${error ? "fault" : ""}`}>
            <Radio size={14} />
            {error ? "LINK DEGRADED" : "LIVE TELEMETRY"}
          </div>
          <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} aria-label="Repository scope">
            <option value="ALL">All monitored repos</option>
            {snapshot?.repos.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>{repo.fullName}</option>
            ))}
          </select>
          <button className="icon-button" onClick={refresh} disabled={loading} title="Refresh telemetry">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
          <button className={`auto-button ${auto ? "on" : ""}`} onClick={() => setAuto((value) => !value)}>
            {auto ? <Zap size={15} /> : <PauseCircle size={15} />}
            Auto {auto ? "30s" : "off"}
          </button>
          {authConfigured ? (
            operator ? (
              <div className="operator-chip">
                <Github size={17} />
                <div>
                  <strong>@{operator.login || operator.name || "operator"}</strong>
                  <span>AUTHORIZED OPERATOR</span>
                </div>
                <a href="/signout">Sign out</a>
              </div>
            ) : (
              <a className="auth-button" href="/signin">
                <Github size={17} />
                Sign in with GitHub
              </a>
            )
          ) : (
            <span className="auth-disabled" title="Set AUTH_SECRET, AUTH_GITHUB_ID, and AUTH_GITHUB_SECRET on the deployment.">
              <LockKeyhole size={15} />
              OAuth setup pending
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <div><strong>Telemetry fault</strong><span>{error}</span></div>
        </div>
      )}

      <section className="hero-grid">
        <div className="panel health-panel riveted">
          <div className="panel-heading">
            <div><p className="eyebrow">CORE INTEGRITY</p><h2>System Pressure</h2></div>
            <ShieldCheck size={22} />
          </div>
          <GaugeRing
            value={selectedRepo === "ALL" ? snapshot?.summary.health ?? 0 : localHealth}
            label="HEALTH"
            detail={failureCount ? `${failureCount} workflow faults detected` : "All sampled workflows nominal"}
          />
          <div className="mini-gauges">
            <div><span>Auth link</span><strong>{snapshot?.authMode === "token" ? "SECURE" : "PUBLIC"}</strong></div>
            <div><span>Sample depth</span><strong>{snapshot?.repoLimit ?? "—"} REPOS</strong></div>
          </div>
        </div>

        <div className="metric-grid">
          <Metric icon={<Workflow />} value={liveCount} label="Live workflows" tone="blue" />
          <Metric icon={<AlertTriangle />} value={failureCount} label="Recent faults" tone="red" />
          <Metric icon={<GitPullRequest />} value={pulls.length} label="Open pull requests" />
          <Metric icon={<Box />} value={artifacts.filter((a) => !a.expired).length} label="Active artifacts" tone="mint" />
        </div>

        <div className="panel network-panel riveted">
          <div className="panel-heading">
            <div><p className="eyebrow">REPOSITORY CONSTELLATION</p><h2>Network Topology</h2></div>
            <Activity size={21} />
          </div>
          <div className="topology-field">
            <div className="topology-lines" />
            {repos.slice(0, 8).map((repo) => <RepoNode key={repo.fullName} repo={repo} />)}
          </div>
        </div>
      </section>

      <section className="graph-grid">
        <div className="panel graph-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">24 HOUR SIGNAL</p><h2>Workflow Activity</h2></div>
            <Radio size={20} />
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapshot?.activity || []}>
                <defs>
                  <linearGradient id="successFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#61e8bf" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#61e8bf" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failureFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff715b" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#ff715b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#503b28" strokeDasharray="3 5" opacity={0.35} />
                <XAxis dataKey="label" stroke="#8f7659" tickLine={false} axisLine={false} />
                <YAxis stroke="#8f7659" tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={{ background: "#12100d", border: "1px solid #795431", color: "#f3e3c0" }} />
                <Area type="monotone" dataKey="success" stroke="#61e8bf" fill="url(#successFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="failure" stroke="#ff715b" fill="url(#failureFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="running" stroke="#f3c86b" fillOpacity={0} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel distribution-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">RUN DISTRIBUTION</p><h2>Signal Balance</h2></div>
            <Cpu size={20} />
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={snapshot?.statusCounts || []} dataKey="value" innerRadius={57} outerRadius={78} paddingAngle={4}>
                  {(snapshot?.statusCounts || []).map((entry, index) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#12100d", border: "1px solid #795431", color: "#f3e3c0" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-legend">
              {(snapshot?.statusCounts || []).map((entry, index) => (
                <div key={entry.name}>
                  <i style={{ background: STATUS_COLORS[index % STATUS_COLORS.length] }} />
                  <span>{entry.name}</span><strong>{entry.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel graph-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">REPOSITORY LOAD</p><h2>Operational Volume</h2></div>
            <GitBranch size={20} />
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={repoChart}>
                <CartesianGrid stroke="#503b28" strokeDasharray="3 5" opacity={0.28} />
                <XAxis dataKey="name" stroke="#8f7659" tickLine={false} axisLine={false} />
                <YAxis stroke="#8f7659" tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={{ background: "#12100d", border: "1px solid #795431", color: "#f3e3c0" }} />
                <Bar dataKey="workflows" fill="#be7a38" radius={[4, 4, 0, 0]} />
                <Bar dataKey="prs" fill="#63b5c8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="faults" fill="#d65d4a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="ops-grid">
        <div className="panel run-panel riveted">
          <div className="panel-heading">
            <div><p className="eyebrow">ACTION ENGINE</p><h2>Workflow Stream</h2></div>
            <span className="counter">{runs.length} sampled</span>
          </div>
          <div className="run-list">
            {runs.slice(0, 16).map((run) => (
              <article className="run-row" key={`${run.repo}-${run.id}`}>
                <div className={`status-lamp state-${run.state}`} />
                <div className="run-copy">
                  <strong>{run.name}</strong>
                  <span>{run.repo} · {run.branch || "detached"} · {run.sha}</span>
                </div>
                <div className="run-meta">
                  <span className={`status-word state-${run.state}`}>{stateLabel(run)}</span>
                  <small>{ago(run.updatedAt)}</small>
                </div>
                <RunControls
                  run={run}
                  onAction={onAction}
                  busy={actionBusy}
                  enabled={Boolean(operator && snapshot?.capabilities.mutations)}
                />
                <a className="external" href={run.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                  <ExternalLink size={15} />
                </a>
              </article>
            ))}
            {!runs.length && <div className="empty-state">No workflow runs in the current scope.</div>}
          </div>
        </div>

        <div className="side-stack">
          <div className="panel pr-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">MERGE CHAMBER</p><h2>Pull Requests</h2></div>
              <GitPullRequest size={20} />
            </div>
            <div className="compact-list">
              {pulls.slice(0, 7).map((pr) => (
                <a key={`${pr.repo}-${pr.number}`} href={pr.url} target="_blank" rel="noreferrer">
                  <span className="compact-icon">#{pr.number}</span>
                  <div><strong>{pr.title}</strong><small>{pr.repo} · {pr.head} → {pr.base}</small></div>
                  <span className="age">{ago(pr.updatedAt)}</span>
                </a>
              ))}
              {!pulls.length && <div className="empty-state">No open pull requests.</div>}
            </div>
          </div>

          <div className="panel artifact-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">ARTIFACT VAULT</p><h2>Recent Payloads</h2></div>
              <Box size={20} />
            </div>
            <div className="compact-list">
              {artifacts.slice(0, 7).map((artifact) => (
                <div key={`${artifact.repo}-${artifact.id}`} className="artifact-row">
                  <span className="compact-icon"><Box size={14} /></span>
                  <div><strong>{artifact.name}</strong><small>{artifact.repo} · {fmtBytes(artifact.size)}</small></div>
                  <span className={artifact.expired ? "expired age" : "age"}>{artifact.expired ? "expired" : ago(artifact.createdAt)}</span>
                </div>
              ))}
              {!artifacts.length && <div className="empty-state">No artifacts in sample.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel runner-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">RUNNER TURBINES</p><h2>Compute Pressure</h2></div>
            <Cpu size={20} />
          </div>
          <div className="runner-grid">
            {repos.map((repo) => {
              const known = repo.runnerCount !== null;
              const pct = known && repo.runnerCount ? Math.round(((repo.busyRunners || 0) / repo.runnerCount) * 100) : 0;
              return (
                <div className="runner-unit" key={repo.fullName}>
                  <div className={`turbine ${pct ? "spinning" : ""}`}><Settings size={30} /></div>
                  <div><strong>{repo.name}</strong><span>{known ? `${repo.busyRunners || 0}/${repo.runnerCount} busy` : "runner data unavailable"}</span></div>
                  <div className="pressure-bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel console-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">COMMAND BUS</p><h2>Operator Console</h2></div>
            <Activity size={20} />
          </div>
          <div className="console">
            <span className="prompt">AEGIS&gt;</span>
            <p>{commandLog}</p>
          </div>
          <div className="console-meta">
            <span><CheckCircle2 size={14} /> Last sample {snapshot ? ago(snapshot.generatedAt) : "pending"}</span>
            <span><Radio size={14} /> {snapshot?.authMode === "token" ? "Authenticated GitHub API" : "Public API fallback"}</span>
            <span><Github size={14} /> {operator ? `Operator @${operator.login || operator.name || "signed-in"}` : "No operator session"}</span>
          </div>
        </div>
      </section>

      <footer>
        <span>AEGIS CONTROL SURFACE // {snapshot?.owner || "SouthPaw302"}</span>
        <span>Read telemetry is live. Mutating controls remain server-guarded.</span>
      </footer>
    </main>
  );
}
