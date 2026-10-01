import { useEffect, useState } from "react";
import type { EvidenceItem, RunState } from "../store";
import { Icon, icons, type IconName } from "./Icon";
import { TaskCard, taskLetter } from "./TaskCard";
import { ModalOverlay, Modal, Dialog } from "react-aria-components";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { ScrollRegion } from "./ScrollRegion";
import { cx } from "@/utils/cx";

const EVIDENCE_ICON: Record<string, IconName> = {
  check: "check",
  screenshot: "image",
  "git-diff": "code",
  "git-diff-stat": "code",
  "git-status": "branch",
  log: "file",
  events: "activity",
  file: "file",
};
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
function evidenceUrl(runId: string, path: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/file?path=${encodeURIComponent(path)}`;
}

function EvidencePreview({
  item,
  runId,
  demo,
  onClose,
}: {
  item: EvidenceItem;
  runId: string;
  demo: boolean;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = evidenceUrl(runId, item.path);
  const image =
    item.evidenceType === "screenshot" ||
    /\.(png|jpe?g|webp)$/i.test(item.path);

  useEffect(() => {
    if (image) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Could not load this artifact (HTTP ${response.status}).`,
          );
        return response.text();
      })
      .then((text) =>
        setContent(
          text.length > 120000
            ? text.slice(0, 120000) +
                "\n\n[Preview truncated. Open the full file to see more.]"
            : text,
        ),
      )
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [url, image]);

  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="evidence-overlay"
    >
      <Modal className="evidence-dialog">
        <Dialog aria-labelledby="preview-title" className="outline-none">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">ARTIFACT PREVIEW</span>
              <h2 id="preview-title">{item.label ?? fileName(item.path)}</h2>
            </div>
            <IconButton
              size="small"
              icon={icons.close}
              onClick={onClose}
              aria-label="Close artifact preview"
              autoFocus
            />
          </div>
          <div className="preview-meta">
            <span className="mono">{item.path}</span>
            <a href={url} target="_blank" rel="noreferrer">
              Open file <Icon name="arrow" size={13} />
            </a>
          </div>
          {demo && (
            <p className="demo-notice">
              Demo artifact — sample content for this scripted run.
            </p>
          )}
          <ScrollRegion className="preview-body">
            {error ? (
              <p role="alert">{error}</p>
            ) : image ? (
              <img
                src={url}
                alt={item.label ?? fileName(item.path)}
                onError={() => setError("Could not load this image.")}
              />
            ) : content === null ? (
              <p role="status">Loading artifact…</p>
            ) : (
              <pre>{content}</pre>
            )}
          </ScrollRegion>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function EvidencePanel({
  run,
  mode,
  onClose,
}: {
  run: RunState;
  mode: "mock" | "live" | null;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<EvidenceItem | null>(null);
  useEffect(() => setPreview(null), [run.runId]);
  const groups = run.taskOrder
    .map((taskId, index) => ({ task: run.tasks[taskId], index }))
    .filter(({ task }) => Boolean(task));
  const count = groups.reduce((sum, { task }) => sum + task.evidence.length, 0);
  return (
    <aside
      className="panel evidence-panel"
      id="evidence-panel"
      aria-label="Run details and evidence"
    >
      <div className="panel-heading">
        <div>
          <h2>Run details</h2>
          <span>The work, and the proof.</span>
        </div>
        <IconButton
          size="small"
          icon={icons.close}
          onClick={onClose}
          aria-label="Close evidence panel"
        />
      </div>
      <ScrollRegion className="evidence-scroll">
        <div className="detail-section-heading">
          <h3>Tasks</h3>
          <span className="count-badge">{groups.length}</span>
        </div>
        <div className="task-list">
          {groups.map(({ task, index }) => (
            <TaskCard key={task.id} task={task} index={index} />
          ))}
          {groups.length === 0 && (
            <p className="detail-empty">
              The coordinator's tasks will appear here.
            </p>
          )}
        </div>
        <div className="detail-section-heading">
          <h3>Evidence</h3>
          <span className="count-badge">{count}</span>
        </div>
        {groups
          .filter(({ task }) => task.evidence.length > 0)
          .map(({ task, index }) => (
            <div className="evidence-group" key={task.id}>
              <h4>
                <span className="evidence-group-dot" />
                Codex {taskLetter(index)}
                <span>{task.evidence.length} artifacts</span>
              </h4>
              <ul>
                {task.evidence.map((item) => {
                  const label = item.label ?? fileName(item.path);
                  const contents = (
                    <>
                      <span
                        className={cx(
                          `evidence-icon type-${item.evidenceType}`,
                        )}
                      >
                        <Icon
                          name={EVIDENCE_ICON[item.evidenceType] ?? "file"}
                          size={16}
                        />
                      </span>
                      <span className="evidence-label">
                        <strong>{label}</strong>
                        <span>
                          {item.evidenceType === "check"
                            ? "Check recorded"
                            : item.evidenceType.replaceAll("-", " ")}
                        </span>
                      </span>
                      {item.path && <Icon name="chevron" size={13} />}
                    </>
                  );
                  return (
                    <li
                      key={`${item.evidenceType}/${item.path}/${item.label ?? ""}`}
                    >
                      {item.path && run.runId ? (
                        <button
                          className="evidence-item"
                          onClick={() => setPreview(item)}
                          title={item.path}
                        >
                          {contents}
                        </button>
                      ) : (
                        <div className="evidence-item">{contents}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        {count === 0 && (
          <div className="evidence-empty">
            <span className="empty-icon">
              <Icon name="file" size={23} />
            </span>
            <strong>Proof lives here</strong>
            <p>
              Logs, diffs, checks, and screenshots appear as the team works.
            </p>
          </div>
        )}
        <div className="review-note">
          <span className="review-note-icon">
            <Icon name="branch" size={16} />
          </span>
          <div>
            <strong>You have the final say.</strong>
            <p>Review verified changes before integrating the worktrees.</p>
          </div>
        </div>
      </ScrollRegion>
      {preview && run.runId && (
        <EvidencePreview
          item={preview}
          runId={run.runId}
          demo={mode === "mock"}
          onClose={() => setPreview(null)}
        />
      )}
    </aside>
  );
}
