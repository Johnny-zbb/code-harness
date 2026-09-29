import { useEffect, useState } from 'preact/hooks';
import { deriveMetrics, formatElapsed, type RunState } from '../store';
import { FoldAvatar, agentVisual, moodFromTone } from './FoldAvatar';

const RUN_STATUS_LABEL: Record<RunState['status'], string> = {
  idle: 'Waiting',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function RunHeader({ run }: { run: RunState }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const metrics = deriveMetrics(run);
  const repoLine = [run.repo, run.branch].filter(Boolean).join(' / ') || '—';
  const tone = run.status === 'running' ? 'busy' : run.status === 'idle' || run.status === 'stopped' ? 'idle' : run.status;

  return (
    <header class="run-header">
      <div class="run-header-top">
        <div class="brand">
          <FoldAvatar {...agentVisual('coordinator', 0)} size={36} mood={moodFromTone(tone)} label="Kumo" />
          <span class="brand-name">Kumo</span>
          <span class="brand-sub">Control Plane</span>
        </div>
        <div class="run-meta">
          <span class="meta-pill mono">Run #{(run.runId ?? '—').replace(/^run-/, '')}</span>
          <span class="meta-pill">{repoLine}</span>
          <span class={`status-chip tone-${tone}`}>
            <span class="dot" />
            {RUN_STATUS_LABEL[run.status]}
          </span>
        </div>
      </div>
      <div class="run-metrics" aria-label="run metrics">
        <span class="metric">{metrics.agents} Agents</span>
        <span class="metric-sep">·</span>
        <span class="metric">{formatElapsed(run.startedAt, run.completedAt, now)}</span>
        <span class="metric-sep">·</span>
        <span class="metric">{metrics.verifiedLabel} Verified</span>
        <span class="metric-sep">·</span>
        <span class="metric">{metrics.conflicts} Conflicts</span>
        <span class="metric-sep">·</span>
        <span class="metric">{metrics.retries} Retry</span>
      </div>
    </header>
  );
}
