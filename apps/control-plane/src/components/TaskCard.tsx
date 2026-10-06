import type { TaskState } from "../store";
import { FoldAvatar, agentVisual } from "./FoldAvatar";
import { Icon } from "./Icon";
import { cx } from "@/utils/cx";

const LABEL = {
  queued: "Queued",
  coding: "Building",
  verifying: "Verifying",
  passed: "Verified",
  failed: "Needs attention",
};
export function taskLetter(index: number): string {
  return String.fromCharCode(65 + Math.max(0, index));
}

export function TaskCard({ task, index }: { task: TaskState; index: number }) {
  const stage = task.status === "queued" ? 0 : task.status === "coding" ? 1 : 2;
  return (
    <div className={cx(`task-card status-${task.status}`)}>
      <div className="task-card-top">
        <FoldAvatar
          {...agentVisual("worker", index)}
          size={32}
          mood={
            task.status === "passed"
              ? "happy"
              : task.status === "failed"
                ? "sad"
                : "busy"
          }
          label={`Codex ${taskLetter(index)}`}
        />
        <span className="task-badge">TASK {taskLetter(index)}</span>
        <span
          className={cx(
            `task-status tone-${task.status === "passed" || task.status === "failed" ? task.status : "busy"}`,
          )}
        >
          {task.status === "passed" && <Icon name="check" size={12} />}
          {LABEL[task.status]}
        </span>
      </div>
      <h3 className="task-title">{task.title}</h3>
      {task.attempt > 1 && (
        <span className="task-attempt">
          <Icon name="retry" size={11} />
          Retry {task.attempt - 1}
        </span>
      )}
      <div className="task-stages">
        {["Queued", "Build", "Verify"].map((label, step) => (
          <span key={label} className={step <= stage ? "reached" : ""}>
            <i />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
