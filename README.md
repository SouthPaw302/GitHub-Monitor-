# AEGIS // GitHub Monitor

**Live command deck:** https://githubmonitor-seven.vercel.app/

A hyper-visual steampunk/futurist GitHub operations command deck for the SouthPaw302 ecosystem.

## What it does

- Live repository telemetry
- GitHub Actions workflow stream
- Success/failure/running distribution graphs
- 24-hour workflow activity graph
- Repository operational-volume graph
- Open pull-request chamber
- Artifact vault
- Deployment sampling
- Optional self-hosted runner pressure display
- Guarded workflow controls for rerun, rerun-failed, and cancel
- Automatic 30-second browser refresh
- GitHub Actions CI and telemetry snapshot jobs

## Stack

- Next.js App Router
- React + TypeScript
- Recharts
- GitHub REST API
- GitHub Actions
- Vercel-ready deployment

## Environment

Create these as server-side environment variables:

```bash
MONITOR_OWNER=SouthPaw302
MONITOR_GITHUB_TOKEN=github_pat_...
MONITOR_REPOS=SouthPaw302/AIVideoEdit,SouthPaw302/GitHub-Monitor-
MONITOR_MUTATIONS_ENABLED=false
```

`MONITOR_GITHUB_TOKEN` is optional for public repositories, but authenticated mode increases rate limits and enables runner telemetry. Never expose the token to the browser.

Workflow mutation buttons are fail-closed. They only operate when `MONITOR_MUTATIONS_ENABLED=true` and a token with the required Actions permissions is available.

If `MONITOR_REPOS` is omitted, the backend monitors the most recently pushed non-archived repositories owned by `MONITOR_OWNER`. Authenticated mode samples up to 10 repositories; public fallback samples 2 to protect GitHub API quota.

## Development

```bash
npm install
npm run typecheck
npm run dev
```

Open http://localhost:3000.

## Architecture

Browser → `/api/monitor` → server-side GitHub adapter → GitHub REST API.

Operator controls → `/api/action` → owner-scope validation → mutation safety gate → GitHub Actions API.

The browser never receives the GitHub token.

## Security posture

- Server-only credentials
- Owner-scope allowlist on workflow mutations
- Mutating controls disabled by default
- No token persistence in browser storage
- No automatic merge or branch-write controls
- Read-only telemetry continues to work without mutation permissions
