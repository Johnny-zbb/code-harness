/**
 * The only contract the control-plane UI understands.
 *
 * The UI never touches git worktrees, Codex CLI, pstack, or verification.
 * Every coding-agent backend (Codex JSONL, Claude Code, OpenCode, ...) is
 * translated into this stream by the local server before it reaches the UI.
 *
 * Deltas from the initial sketch, kept deliberately minimal:
 * - `agent.message.taskId` is optional: the coordinator talks before tasks exist.
 * - `run.started` carries optional repo/branch/requirement so the header and the
 *   opening "User" bubble can render without extra endpoints.
 * - `task.started` carries an optional `attempt` (1-based) so the Retry metric
 *   is derivable without a new event type.
 * - `evidence.created` carries an optional `label` so named checks (typecheck,
 *   eslint, ...) render nicely when the artifact is not a file.
 * - `run.completed` closes the run so the elapsed timer and run status dot stop.
 */
export type HarnessAgent = 'coordinator' | 'worker' | 'verifier';

export type TaskStatus = 'queued' | 'coding' | 'verifying' | 'passed' | 'failed';

export type HarnessEvent =
  | {
      type: 'run.started';
      runId: string;
      repo?: string;
      branch?: string;
      requirement?: string;
      startedAt?: string;
    }
  | { type: 'task.started'; taskId: string; title?: string; attempt?: number; branch?: string }
  | { type: 'agent.message'; taskId?: string | null; agent: HarnessAgent; text: string; ts?: string }
  | { type: 'agent.status'; taskId: string; status: TaskStatus }
  | { type: 'evidence.created'; taskId: string; evidenceType: string; path: string; label?: string }
  | { type: 'task.completed'; taskId: string; status: 'passed' | 'failed' }
  | { type: 'run.completed'; runId: string; status: 'passed' | 'failed' | 'stopped'; finishedAt?: string };
