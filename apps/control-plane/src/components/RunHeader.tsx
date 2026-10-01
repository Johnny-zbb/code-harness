import { useEffect, useState } from "react";
import { deriveMetrics, formatElapsed, type RunState } from "../store";
import { Icon, type IconName } from "./Icon";
import { Chip } from "@/components/boardui/base/badges/chip";
import { cx } from "@/utils/cx";

const RUN_STATUS_LABEL: Record<RunState["status"], string> = {
  idle: "Waiting for a run",
  running: "Run in progress",
  passed: "Run verified",
  failed: "Needs attention",
  stopped: "Run stopped",
};

export function RunHeader({ run }: { run: RunState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run.status !== "running") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.status]);

  const metrics = deriveMetrics(run);
  const tone =
    run.status === "running"
      ? "busy"
      : run.status === "idle" || run.status === "stopped"
        ? "idle"
        : run.status;
  const cards: {
    label: string;
    value: string | number;
    icon: IconName;
    detail: string;
  }[] = [
    {
      label: "Workers",
      value: metrics.agents,
      icon: "agents",
      detail: "Independent worktrees",
    },
    {
      label: "Elapsed",
      value: formatElapsed(run.startedAt, run.completedAt, now),
      icon: "clock",
      detail: run.completedAt ? "Total run time" : "Since the run started",
    },
    {
      label: "Verified",
      value: metrics.verifiedLabel,
      icon: "check",
      detail: "Tasks passed verification",
    },
    {
      label: "Retries",
      value: metrics.retries,
      icon: "retry",
      detail: "Additional task attempts",
    },
  ];

  return (
    <header className="run-header">
      <div className="run-heading">
        <div>
          <div className="eyebrow">MULTI-AGENT ORCHESTRATOR</div>
          <h1>
            A few minds. One run<span>.</span>
          </h1>
          <p>
            Your agents, their conversations, and the proof behind every change.
          </p>
        </div>
        <Chip
          variant="caption"
          color={
            tone === "passed"
              ? "lime"
              : tone === "failed"
                ? "rose"
                : tone === "busy"
                  ? "blue"
                  : "soft"
          }
          className="run-status"
        >
          <span className="dot" />
          {RUN_STATUS_LABEL[run.status]}
        </Chip>
      </div>
      <div className="run-context">
        <span>
          <Icon name="code" size={14} />
          {run.repo ?? "Waiting for repository"}
        </span>
        <span className="context-divider" />
        <span className="mono" title={run.branch ?? ""}>
          <Icon name="branch" size={14} />
          {run.branch ?? "—"}
        </span>
        <span className="context-run mono" title={run.runId ?? ""}>
          {run.runId ?? "No active run"}
        </span>
      </div>
      <div className="run-metrics" aria-label="Run metrics">
        {cards.map((card) => (
          <div
            className={cx(`metric-card metric-${card.label.toLowerCase()}`)}
            key={card.label}
          >
            <div className="metric-heading">
              <span>{card.label}</span>
              <Icon name={card.icon} size={17} />
            </div>
            <strong className="metric-value">{card.value}</strong>
            <span className="metric-detail">{card.detail}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
