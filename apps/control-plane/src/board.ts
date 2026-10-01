export type BoardStatus =
  | "queued"
  | "running"
  | "verifying"
  | "review"
  | "approved"
  | "merged"
  | "blocked";
export interface VerificationReport {
  verdict: "passed" | "failed" | "blocked";
  summary: string;
  headSha?: string;
  checks: { name: string; status: string; evidence: string }[];
}
export interface BoardAttempt {
  number: number;
  startedAt: string;
  finishedAt?: string;
  status: string;
  runId?: string;
  branch?: string;
  worktree?: string;
  evidenceDir?: string;
  headSha?: string;
  workerExitCode?: number;
  verifierExitCode?: number;
  checkExitCode?: number | null;
  verification?: VerificationReport;
  error?: string;
}
export interface BoardTask {
  id: string;
  title: string;
  description: string;
  acceptance: string;
  repo: string;
  targetBranch: string;
  checkCommand: string;
  status: BoardStatus;
  createdAt: string;
  updatedAt: string;
  branch?: string;
  worktree?: string;
  headSha?: string;
  error: string | null;
  messages: { role: "user" | "agent" | "system"; text: string; at: string }[];
  attempts: BoardAttempt[];
  activity?: { role: "worker" | "verifier"; text: string }[];
}
export interface BoardSnapshot {
  tasks: BoardTask[];
  defaultRepo: string;
  runner: "codex" | "test-fixture";
  concurrency: number;
  revision: number;
}
export const boardStatus: Record<
  BoardStatus,
  {
    label: string;
    color: "soft" | "blue" | "purple" | "yellow" | "lime" | "rose";
  }
> = {
  queued: { label: "待办", color: "soft" },
  running: { label: "开发中", color: "blue" },
  verifying: { label: "验证中", color: "purple" },
  review: { label: "待验收", color: "yellow" },
  approved: { label: "待合入", color: "lime" },
  merged: { label: "已合入", color: "lime" },
  blocked: { label: "需要处理", color: "rose" },
};
export const repoName = (repo: string) =>
  repo.split(/[\\/]/).filter(Boolean).at(-1) || repo;
export const artifactUrl = (
  task: BoardTask,
  attempt: BoardAttempt,
  file: string,
) =>
  `/api/board/tasks/${task.id}/attempts/${attempt.number}/file?path=${encodeURIComponent(file)}`;
export async function boardRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
