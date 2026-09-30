import type { TaskState } from '../store';

const TASK_STATUS_LABEL: Record<TaskState['status'], string> = {
  queued: 'Queued',
  coding: 'Coding',
  verifying: 'Verifying',
  passed: 'Passed',
  failed: 'Failed',
};

export function taskLetter(index: number): string {
  return String.fromCharCode(65 + Math.max(0, index));
}

export function TaskCard({ task, index }: { task: TaskState; index: number }) {
  return (
    <div class={`task-card status-${task.status}`}>
      <div class="task-card-main">
        <span class="task-badge">Task {taskLetter(index)}</span>
        <span class="task-title" title={task.title}>{task.title}</span>
        {task.attempt > 1 && <span class="task-attempt">retry #{task.attempt - 1}</span>}
      </div>
      <span class="task-status">{TASK_STATUS_LABEL[task.status]}</span>
    </div>
  );
}
