import { useState } from "react";
import { deriveAgentRows, deriveMetrics, type RunState } from "../store";
import { FoldAvatar, agentVisual, moodFromTone } from "./FoldAvatar";
import { Icon, icons } from "./Icon";
import { Button } from "@/components/boardui/base/buttons/button";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { Input } from "@/components/boardui/base/input/input";
import { ScrollRegion } from "./ScrollRegion";
import { cx } from "@/utils/cx";

interface Props {
  run: RunState;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  dark: boolean;
  onTheme: () => void;
}

export function AgentList({
  run,
  selectedKey,
  onSelect,
  dark,
  onTheme,
}: Props) {
  const [search, setSearch] = useState("");
  const rows = deriveAgentRows(run);
  const visible = rows.filter((row) =>
    `${row.name} ${row.role}`.toLowerCase().includes(search.toLowerCase()),
  );
  const metrics = deriveMetrics(run);
  const passed = run.taskOrder.filter(
    (id) => run.tasks[id]?.status === "passed",
  ).length;

  return (
    <aside className="sidebar" aria-label="Workspace sidebar">
      <div className="brand">
        <span className="brand-avatar">
          <FoldAvatar
            {...agentVisual("coordinator", 0)}
            size={42}
            mood="idle"
            label="Kumo"
          />
        </span>
        <div>
          <span className="brand-name">
            kumo<span className="brand-period">.</span>
          </span>
          <span className="brand-sub">A shared space for agents</span>
        </div>
      </div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <Button
        size="small"
        variant={!selectedKey ? "ghost" : "secondary"}
        leadingIcon={icons.grid}
        className={cx("workspace-nav", !selectedKey && "selected")}
        onClick={() => onSelect(null)}
        aria-pressed={!selectedKey}
      >
        <span>All activity</span>
        <span className="nav-count">{run.messages.length}</span>
      </Button>
      <div className="sidebar-section-heading">
        <span className="sidebar-section-label">YOUR TEAM</span>
        <span className="count-badge">{rows.length}</span>
      </div>
      <Input
        className="team-search"
        size="small"
        type="search"
        leadingIcon={icons.search}
        placeholder="Find an agent…"
        aria-label="Find an agent"
        value={search}
        onChange={setSearch}
      />
      <ScrollRegion className="team-scroll" containerClassName="team-region">
        <ul className="team-list">
          {visible.map((row) => (
            <li key={row.key}>
              <Button
                variant="secondary"
                className={cx(
                  "agent-row",
                  selectedKey === row.key && "selected",
                )}
                onClick={() =>
                  onSelect(selectedKey === row.key ? null : row.key)
                }
                aria-label={`${row.name} · ${row.role} · ${row.statusLabel}`}
                aria-pressed={selectedKey === row.key}
              >
                <span className="agent-row-content">
                  <span className={cx(`avatar-tile avatar-${row.agentRole}`)}>
                    <FoldAvatar
                      {...agentVisual(row.agentRole, row.agentIndex)}
                      size={42}
                      mood={moodFromTone(row.tone)}
                      label={row.name}
                    />
                    <span className={cx(`agent-presence tone-${row.tone}`)} />
                  </span>
                  <span className="agent-info">
                    <span className="agent-name">{row.name}</span>
                    <span className="agent-role" title={row.role}>
                      {row.role}
                    </span>
                  </span>
                  <span
                    className={cx(`agent-state tone-${row.tone}`)}
                    title={row.statusLabel}
                  >
                    {row.statusLabel}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
        {visible.length === 0 && (
          <p className="sidebar-empty">No agents match “{search}”.</p>
        )}
      </ScrollRegion>
      <div className="sidebar-bottom">
        <div className="run-summary">
          <div className="run-summary-top">
            <span className="summary-icon">
              <Icon name="branch" size={16} />
            </span>
            <span>Current run</span>
            <span
              className={cx(
                `dot tone-${run.status === "running" ? "busy" : run.status}`,
              )}
            />
          </div>
          <strong title={run.repo ?? ""}>{run.repo ?? "Getting ready…"}</strong>
          <span className="summary-branch mono" title={run.branch ?? ""}>
            {run.branch ?? "Waiting for a run"}
          </span>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Verified tasks"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, metrics.agents)}
            aria-valuenow={passed}
          >
            <span
              style={{
                width: `${metrics.agents ? (passed / metrics.agents) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="summary-progress">
            <span>{metrics.verifiedLabel} tasks verified</span>
            <span>
              {metrics.agents ? Math.round((passed / metrics.agents) * 100) : 0}
              %
            </span>
          </div>
        </div>
        <div className="sidebar-foot">
          <span className="local-user">J</span>
          <div>
            <strong>Local workspace</strong>
            <span>code-harness</span>
          </div>
          <IconButton
            size="small"
            icon={dark ? icons.sun : icons.moon}
            onClick={onTheme}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          />
        </div>
      </div>
    </aside>
  );
}
