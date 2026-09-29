# Control Plane UI

Thin BoardUI-style console over the [multi-agent orchestrator](../../skills/multi-agent-orchestrator/). One screen: agents, conversation, evidence — plus the metrics that tell you whether the system works (`2 Agents · 1m 42s · 1/2 Verified · 0 Conflicts · 1 Retry`).

**The UI owns no orchestration logic.** It never touches git worktrees, Codex CLI, pstack, or verification. It only folds a unified `HarnessEvent` stream.

The visual layer imitates the BoardUI multi-agent-chat look with original code: `src/components/FoldAvatar.tsx` draws canvas "fold" avatars (wandering, blinking eyes) whose mood tracks harness state — busy agents glance around, passed agents smile, failed ones frown. A conversation badge gathers the participating avatars, BoardUI-style.

```text
run.json / worker-events.jsonl / verifier-events.jsonl
        ↓
local Node server (zero-dep, fs.watch)   ← also: scripted mock source
        ↓
SSE  (GET /api/events)
        ↓
Preact UI  (pure reducer over HarnessEvent)
```

## Quickstart

```bash
cd apps/control-plane
npm install
npm run dev        # mock run + Vite dev server (UI on :5173, API on :8787)
```

Watch the scripted demo run (~35s): two workers, one verifier rejection, one retry, then both tasks pass.

Production-style serving (built UI + API on one port):

```bash
npm run build
npm start                       # mock mode if no runs found
npm run dev:server:live -- --runs-dir /path/to/.code-harness-runs
```

The server auto-discovers runs under `.code-harness-runs/` next to the cwd (the same layout `orchestrate.mjs` writes). Every SSE (re)connect replays the run from the beginning, then tails live JSONL appends and newly dropped evidence files.

## Event contract

`src/types.ts` is the single source of truth. The UI understands nothing else.

```ts
type HarnessEvent =
  | { type: 'run.started'; runId: string; repo?: string; branch?: string; requirement?: string; startedAt?: string }
  | { type: 'task.started'; taskId: string; title?: string; attempt?: number; branch?: string }
  | { type: 'agent.message'; taskId?: string | null; agent: 'coordinator' | 'worker' | 'verifier'; text: string }
  | { type: 'agent.status'; taskId: string; status: 'queued' | 'coding' | 'verifying' | 'passed' | 'failed' }
  | { type: 'evidence.created'; taskId: string; evidenceType: string; path: string; label?: string }
  | { type: 'task.completed'; taskId: string; status: 'passed' | 'failed' }
  | { type: 'run.completed'; runId: string; status: 'passed' | 'failed' | 'stopped' }
```

Deliberate extensions to the original sketch: optional `taskId` on messages (the coordinator talks before tasks exist), `attempt` on `task.started` (derives the Retry metric), `label` on evidence (named checks like `typecheck`), and `run.completed` (stops the elapsed timer). Future backends (Claude Code, OpenCode, DeepSeek) only need to translate into this stream; the UI stays untouched.

## HTTP API

| Method | Route | Status |
| --- | --- | --- |
| GET | `/api/runs` | list discovered runs |
| GET | `/api/events` | SSE for the latest run (mock fallback when no runs exist) |
| GET | `/api/runs/:id/events` | SSE for a specific run |
| GET | `/api/runs/:id/file?path=` | evidence file preview (path-traversal guarded) |
| POST | `/api/runs`, `/api/runs/:id/stop`, `/api/tasks/:id/retry` | **501 stubs** — wired in step 6 |

## Roadmap

1. ✅ BoardUI-style UI shell (this screen)
2. ✅ UI driven by mock `HarnessEvent`s
3. ✅ Codex JSONL → `HarnessEvent` mapper (`server/codex-events.mjs`, tolerant to both current and legacy Codex event shapes)
4. ✅ SSE serving of real runs (`server/run-source.mjs`: replay + watch/poll tail)
5. ⬜ First real two-agent run against `next-console`
6. ⬜ Wire Start / Stop / Retry / Approve POST endpoints into the orchestrator

## Tests

```bash
npm test          # node --test: event mapper fixtures + run replay/live-append
npm run typecheck
```
