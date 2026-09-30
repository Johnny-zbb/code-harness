import { deriveAgentRows, type RunState } from '../store';
import { FoldAvatar, agentVisual, moodFromTone } from './FoldAvatar';

export function AgentList({ run }: { run: RunState }) {
  const rows = deriveAgentRows(run);

  return (
    <section class="panel agent-list">
      <h2>Agents</h2>
      <ul>
        {rows.map((row) => (
          <li key={row.key} class={`agent-row tone-${row.tone}`}>
            <FoldAvatar
              {...agentVisual(row.agentRole, row.agentIndex)}
              size={34}
              mood={moodFromTone(row.tone)}
              label={row.name}
            />
            <span class="agent-info">
              <span class="agent-name">{row.name}</span>
              <span class="agent-role" title={row.role}>{row.role}</span>
            </span>
            <span class={`status-chip chip-${row.tone}`}>
              <span class="dot" />
              {row.statusLabel}
            </span>
          </li>
        ))}
      </ul>
      {rows.length === 1 && <p class="panel-hint">Waiting for the coordinator…</p>}
    </section>
  );
}
