import type { HarnessAgent, HarnessEvent, TaskStatus } from './types';

export interface EvidenceItem {
  evidenceType: string;
  path: string;
  label?: string;
}

export interface ChatMessage {
  id: number;
  taskId: string | null;
  agent: HarnessAgent;
  text: string;
  ts?: string;
}

export interface TaskState {
  id: string;
  title: string;
  status: TaskStatus;
  attempt: number;
  branch?: string;
  evidence: EvidenceItem[];
}

export type RunStatus = 'idle' | 'running' | 'passed' | 'failed' | 'stopped';

export interface RunState {
  runId: string | null;
  repo: string | null;
  branch: string | null;
  requirement: string | null;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  tasks: Record<string, TaskState>;
  taskOrder: string[];
  messages: ChatMessage[];
  conflicts: number;
}

export const initialRunState: RunState = {
  runId: null,
  repo: null,
  branch: null,
  requirement: null,
  status: 'idle',
  startedAt: null,
  completedAt: null,
  tasks: {},
  taskOrder: [],
  messages: [],
  conflicts: 0,
};

/** Pure reducer: the UI is a fold over the HarnessEvent stream. */
export function applyEvent(state: RunState, event: HarnessEvent): RunState {
  switch (event.type) {
    case 'run.started':
      return {
        ...initialRunState,
        runId: event.runId,
        repo: event.repo ?? null,
        branch: event.branch ?? null,
        requirement: event.requirement ?? null,
        status: 'running',
        startedAt: event.startedAt ?? new Date().toISOString(),
      };
    case 'task.started': {
      const existing = state.tasks[event.taskId];
      const attempt = Math.max(event.attempt ?? 1, existing?.attempt ?? 1);
      const task: TaskState = {
        id: event.taskId,
        title: event.title ?? existing?.title ?? event.taskId,
        status: 'queued',
        attempt,
        branch: event.branch ?? existing?.branch,
        evidence: existing?.evidence ?? [],
      };
      return {
        ...state,
        tasks: { ...state.tasks, [event.taskId]: task },
        taskOrder: existing ? state.taskOrder : [...state.taskOrder, event.taskId],
      };
    }
    case 'agent.message':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: state.messages.length, taskId: event.taskId ?? null, agent: event.agent, text: event.text, ts: event.ts },
        ],
      };
    case 'agent.status': {
      const task = state.tasks[event.taskId];
      if (!task || task.status === event.status) return state;
      return { ...state, tasks: { ...state.tasks, [event.taskId]: { ...task, status: event.status } } };
    }
    case 'evidence.created': {
      const task = state.tasks[event.taskId];
      if (!task) return state;
      const existingIndex = task.evidence.findIndex(
        (item) => item.path === event.path && item.evidenceType === event.evidenceType && (Boolean(event.path) || item.label === event.label),
      );
      if (existingIndex >= 0) {
        if (!event.label || task.evidence[existingIndex].label === event.label) return state;
        const evidence = task.evidence.map((item, index) => index === existingIndex ? { ...item, label: event.label } : item);
        return { ...state, tasks: { ...state.tasks, [event.taskId]: { ...task, evidence } } };
      }
      const next: TaskState = {
        ...task,
        evidence: [...task.evidence, { evidenceType: event.evidenceType, path: event.path, label: event.label }],
      };
      return { ...state, tasks: { ...state.tasks, [event.taskId]: next } };
    }
    case 'task.completed': {
      const task = state.tasks[event.taskId];
      if (!task) return state;
      return { ...state, tasks: { ...state.tasks, [event.taskId]: { ...task, status: event.status } } };
    }
    case 'run.completed':
      return { ...state, status: event.status, completedAt: event.finishedAt ?? new Date().toISOString() };
    default:
      return state;
  }
}

export interface AgentRow {
  key: string;
  name: string;
  role: string;
  statusLabel: string;
  tone: 'idle' | 'busy' | 'passed' | 'failed';
  agentRole: 'coordinator' | 'worker' | 'verifier';
  /** Worker/verifier ordinal (0-based) used to derive a stable avatar identity. */
  agentIndex: number;
  taskId?: string;
}

export function workerName(index: number): string {
  return `Codex ${String.fromCharCode(65 + index)}`;
}

function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'coding':
      return 'Coding';
    case 'verifying':
      return 'Verifying';
    case 'passed':
      return 'Done';
    case 'failed':
      return 'Failed';
  }
}

function taskTone(status: TaskStatus): AgentRow['tone'] {
  switch (status) {
    case 'queued':
      return 'idle';
    case 'coding':
    case 'verifying':
      return 'busy';
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
  }
}

export function deriveAgentRows(state: RunState): AgentRow[] {
  const rows: AgentRow[] = [];
  const runLabel: Record<RunStatus, string> = {
    idle: 'Idle',
    running: 'Running',
    passed: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
  };
  const runTone: Record<RunStatus, AgentRow['tone']> = {
    idle: 'idle',
    running: 'busy',
    passed: 'passed',
    failed: 'failed',
    stopped: 'idle',
  };
  rows.push({
    key: 'coordinator',
    name: 'Kumo',
    role: 'Coordinator',
    statusLabel: runLabel[state.status],
    tone: runTone[state.status],
    agentRole: 'coordinator',
    agentIndex: 0,
  });

  state.taskOrder.forEach((taskId, index) => {
    const task = state.tasks[taskId];
    if (!task) return;
    rows.push({
      key: `worker-${taskId}`,
      name: workerName(index),
      role: task.title,
      statusLabel: taskStatusLabel(task.status),
      tone: taskTone(task.status),
      agentRole: 'worker',
      agentIndex: index,
      taskId,
    });
    const hasVerifierActivity = state.messages.some((message) => message.taskId === taskId && message.agent === 'verifier');
    if (hasVerifierActivity || task.status === 'verifying' || task.status === 'passed' || task.status === 'failed') {
      rows.push({
        key: `verifier-${taskId}`,
        name: `Verifier ${String.fromCharCode(65 + index)}`,
        role: 'Independent verify',
        statusLabel: task.status === 'verifying' ? 'Checking' : task.status === 'passed' ? 'Passed' : task.status === 'failed' ? 'Failed' : 'Waiting',
        tone: task.status === 'verifying' ? 'busy' : task.status === 'passed' ? 'passed' : task.status === 'failed' ? 'failed' : 'idle',
        agentRole: 'verifier',
        agentIndex: index,
        taskId,
      });
    }
  });

  return rows;
}

export interface RunMetrics {
  agents: number;
  verifiedLabel: string;
  conflicts: number;
  retries: number;
}

export function deriveMetrics(state: RunState): RunMetrics {
  const total = state.taskOrder.length;
  const passed = state.taskOrder.filter((id) => state.tasks[id]?.status === 'passed').length;
  const retries = state.taskOrder.reduce(
    (sum, id) => sum + Math.max(0, (state.tasks[id]?.attempt ?? 1) - 1),
    0,
  );
  return { agents: total, verifiedLabel: `${passed}/${total}`, conflicts: state.conflicts, retries };
}

export function formatElapsed(startedAt: string | null, completedAt: string | null, now: number): string {
  if (!startedAt) return '—';
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return '—';
  const end = completedAt ? Date.parse(completedAt) : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}
