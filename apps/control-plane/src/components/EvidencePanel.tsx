import type { RunState } from '../store';
import { taskLetter } from './TaskCard';

const EVIDENCE_ICON: Record<string, string> = {
  check: '✓',
  screenshot: '📷',
  'git-diff': '📄',
  'git-diff-stat': '📄',
  'git-status': '📄',
  log: '📄',
  events: '🧾',
  file: '📄',
};

function fileName(path: string): string {
  const withoutQuery = path.split('?')[0];
  const segments = withoutQuery.split('/');
  return segments[segments.length - 1] || withoutQuery;
}

export function EvidencePanel({ run }: { run: RunState }) {
  const groups = run.taskOrder
    .map((taskId, index) => ({ task: run.tasks[taskId], index }))
    .filter((group) => group.task && group.task.evidence.length > 0);
  const empty = groups.length === 0;

  return (
    <section class="panel evidence-panel">
      <h2>Evidence</h2>
      {groups.map(({ task, index }) => (
        <div class="evidence-group" key={task.id}>
          <h3>Worker {taskLetter(index)}</h3>
          <ul>
            {task.evidence.map((item) => {
              const label = item.label ?? fileName(item.path);
              const linkable = Boolean(item.path && run.runId);
              return (
                <li key={`${item.evidenceType}/${item.path}`} class={`evidence-item type-${item.evidenceType}`}>
                  <span class="evidence-icon">{EVIDENCE_ICON[item.evidenceType] ?? '📄'}</span>
                  {linkable ? (
                    <a
                      href={`/api/runs/${run.runId}/file?path=${encodeURIComponent(item.path)}`}
                      target="_blank"
                      rel="noreferrer"
                      title={item.path}
                    >
                      {label}
                    </a>
                  ) : (
                    <span title={item.path}>{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {empty && <p class="panel-hint">No evidence yet.</p>}
    </section>
  );
}
