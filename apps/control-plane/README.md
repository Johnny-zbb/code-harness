# Kumo task board

A local task board over the [multi-agent orchestrator](../../skills/multi-agent-orchestrator/). Add a task with requirements and acceptance criteria; the queue starts Codex automatically, develops in an isolated Git worktree, runs an independent verifier, and waits for your decision.

The browser calls the board API. `server/task-board.mjs` persists the queue and review history; the execution kernel owns worktrees, worker/verifier processes, and evidence. The optional **演示工作区** retains the earlier read-only `HarnessEvent` viewer and clearly labels demo data.

The visual layer uses React 19, Tailwind CSS 4, and installed [BoardUI](https://www.boardui.com/installation) components. Buttons, icon buttons, search input, segmented filters, status chips, tooltips, and thinking indicators come from BoardUI; accessible forms and the evidence modal use React Aria, and icons use Remix Icon. Domain-specific conversation, task, and evidence layouts stay local. `src/components/FoldAvatar.tsx` draws canvas "fold" avatars whose mood tracks harness state — busy agents glance around, passed agents smile, failed ones frown.

BoardUI sources live in `src/components/boardui`, with semantic theme and typography tokens in `src/styles`. Configuration is in `boardui.json`; add components with `npx boardui add <name>`. The installed free components and their MIT attribution are documented in `THIRD_PARTY_NOTICES.md`.

## Task workflow

1. **新增任务 → 待办:** choose a local Git repository and enter requirements, acceptance criteria, and an optional project check command. Tasks start from the current branch's committed code. Keep the Node service running; closing the browser does not stop execution.
2. **执行中:** one task at a time. A Codex worker writes code in its own `codex/` branch and worktree. The kernel commits the result locally, then launches a separate Codex verifier. Agent messages appear in the task details as they arrive.
3. **等你验收:** inspect the structured report, checks, diff, and logs. A zero exit code without a valid report is insufficient. Failed checks, a missing report, or changes made during verification block acceptance.
4. **讨论 → 发送并继续开发:** submit feedback to requeue the same task and reuse its branch/worktree. Previous attempts and reports remain available. The new version must be verified again.
5. **验收通过 → 合入代码 → 确认合入:** approval is bound to the displayed commit and does not merge. Confirming merge fast-forwards the local target branch; it never pushes. A dirty checkout or an advanced target branch prevents merge. Send feedback to sync the latest target and verify again when needed.

Tasks, plans, runs, and worktrees live in `.code-harness-board/` at the repository root (ignored by Git). The board has an exclusive service lock. Interrupted running/verifying tasks become **需要处理** after restart, retaining their worktrees; explicit feedback resumes them after the previous worker has stopped.

## Interface

- Search the team and select an agent to see its messages. Activity filters show all messages, workers, or verifiers. Verifiers remain selectable while their workers retry.
- New messages follow the conversation when you are at the bottom. Scroll back to read earlier activity without being pulled away; **Jump to latest** resumes following.
- Run details group task progress and artifacts. Click a log, diff, or screenshot for an in-app preview; Escape closes the preview. Named checks remain distinct, and retry labels update existing files.
- The evidence panel can be hidden. On tablets and phones it opens as a drawer, leaving the conversation visible by default. On phones the team becomes a horizontal strip.
- Light and dark themes share semantic colors; the theme preference is saved locally. CSS and avatar motion respect reduced-motion settings.
- The default screen is the functional task board. Connection state, queued/running tasks, decisions awaiting you, and merged tasks remain distinct. The older team/conversation workspace is available separately as a demo.

```text
run.json / worker-events.jsonl / verifier-events.jsonl
        ↓
local Node server (zero-dep, fs.watch)   ← also: scripted mock source
        ↓
SSE  (GET /api/events)
        ↓
React UI  (pure reducer over HarnessEvent)
```

## Quickstart

```bash
cd apps/control-plane
npm install
codex login        # once, if the local CLI is not already signed in
npm run dev        # real automatic board + Vite (:5173), API (:8787)
```

Node 20+, Git, and a signed-in Codex CLI are required for real execution. `CODEX_BIN` can select a particular executable. The service should run in your normal user environment so the CLI can find its account configuration.

Production-style serving (built UI + API on one port):

```bash
npm run build
npm start                       # real task board on http://127.0.0.1:8787
npm run dev:server:live -- --runs-dir /path/to/.code-harness-runs
node server/server.mjs --repo /path/to/repo --board-dir /path/to/board --port 8787
```

For the optional event viewer, the server discovers runs under `.code-harness-runs/` next to the cwd. Every SSE (re)connect replays a run, then tails live JSONL appends and evidence. Its scripted fallback does not populate the task board.

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
| GET | `/api/board` | persisted tasks, attempts, reports, and current agent messages |
| POST | `/api/board/tasks` | create and automatically queue a task |
| POST | `/api/board/tasks/:id/rework` | append `{text}` feedback and queue another attempt |
| POST | `/api/board/tasks/:id/approve` | approve the verified `{headSha}` |
| POST | `/api/board/tasks/:id/merge` | explicitly merge the approved `{headSha}` locally |
| GET | `/api/board/tasks/:id/attempts/:n/file?path=` | preview evidence within that attempt, including symlink containment |
| GET | `/api/runs` | list discovered runs for the optional event viewer |
| GET | `/api/events` | SSE for the latest run (mock fallback when no runs exist) |
| GET | `/api/runs/:id/events` | SSE for a specific run |
| GET | `/api/runs/:id/file?path=` | evidence file preview (path-traversal guarded) |
| POST | `/api/runs`, `/api/runs/:id/stop`, `/api/tasks/:id/retry` | legacy viewer commands remain **501**; use the board endpoints |

The local service binds to `127.0.0.1`. Board actions require JSON and reject foreign origins. This is a local single-user MVP with concurrency 1; remote hosting, multi-user authentication, automatic push, and parallel scheduling are outside its current scope.

## Tests

```bash
npm test          # real temporary Git repos: queue, verifier failures, feedback, approval, merge, restart, cancellation, HTTP guards; also event viewer tests
npm run typecheck
npm run build
node tests/board-preview.mjs          # browser driver using deterministic workers in a temporary repository (:8788)
node tests/board-preview.mjs --codex  # same isolated workflow using the installed Codex CLI
```
