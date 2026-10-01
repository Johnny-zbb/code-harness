import { useEffect, useRef, useState } from "react";
import { selectMessages, type ActivityFilter } from "../activity";
import type { ConnectionStatus } from "../adapters/harness-events";
import {
  deriveAgentRows,
  type AgentRow,
  type ChatMessage,
  type RunState,
} from "../store";
import {
  FoldAvatar,
  agentVisual,
  moodFromTone,
  type FoldMood,
} from "./FoldAvatar";
import { Icon, icons } from "./Icon";
import { Button } from "@/components/boardui/base/buttons/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/boardui/base/segmented-control/segmented-control";
import { AgentThinking } from "@/components/boardui/application/agent-thinking/agent-thinking";
import { ScrollRegion } from "./ScrollRegion";
import { cx } from "@/utils/cx";

function messageMood(message: ChatMessage, run: RunState): FoldMood {
  if (message.agent === "coordinator")
    return run.status === "passed"
      ? "happy"
      : run.status === "failed"
        ? "sad"
        : "idle";
  const task = message.taskId ? run.tasks[message.taskId] : undefined;
  return task?.status === "passed"
    ? "happy"
    : task?.status === "failed"
      ? "sad"
      : "busy";
}

function Bubble({ message, run }: { message: ChatMessage; run: RunState }) {
  const index = message.taskId ? run.taskOrder.indexOf(message.taskId) : -1;
  const author =
    message.agent === "coordinator"
      ? "Kumo"
      : `${message.agent === "worker" ? "Codex" : "Verifier"} ${index >= 0 ? String.fromCharCode(65 + index) : "?"}`;
  const time =
    message.ts && !Number.isNaN(Date.parse(message.ts))
      ? new Date(message.ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  return (
    <article className={cx(`message agent-${message.agent}`)}>
      <span className={cx(`message-avatar avatar-${message.agent}`)}>
        <FoldAvatar
          {...agentVisual(message.agent, Math.max(0, index))}
          size={38}
          mood={messageMood(message, run)}
          label={author}
        />
      </span>
      <div className="message-content">
        <div className="bubble-head">
          <span className="bubble-author">{author}</span>
          <span className={cx(`role-badge role-${message.agent}`)}>
            {message.agent === "coordinator"
              ? "Coordinator"
              : message.agent === "worker"
                ? "Worker"
                : "Verifier"}
          </span>
          {message.taskId && (
            <span className="bubble-task">{message.taskId}</span>
          )}
          {time && <time dateTime={message.ts}>{time}</time>}
        </div>
        <div className="bubble">
          <p>{message.text}</p>
        </div>
      </div>
    </article>
  );
}

interface Props {
  run: RunState;
  selectedAgent: AgentRow | null;
  onClearSelection: () => void;
  connection: ConnectionStatus;
}

export function AgentChat({
  run,
  selectedAgent,
  onClearSelection,
  connection,
}: Props) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const previousSelection = useRef<string | null>(null);
  const messages = selectMessages(run.messages, filter, selectedAgent);
  const rows = deriveAgentRows(run);

  useEffect(() => {
    const key = selectedAgent?.key ?? null;
    if (previousSelection.current !== key) {
      previousSelection.current = key;
      if (key) setFilter("all");
      setFollow(true);
      if (scroller.current)
        scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [selectedAgent?.key]);

  useEffect(() => {
    if (follow && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages.length, filter, follow, run.status]);

  const filters: { value: ActivityFilter; label: string }[] = [
    { value: "all", label: "All activity" },
    { value: "worker", label: "Workers" },
    { value: "verifier", label: "Verification" },
  ];
  const activeTasks = run.taskOrder.filter((id) =>
    ["coding", "verifying"].includes(run.tasks[id]?.status),
  );
  const terminal = ["passed", "failed", "stopped"].includes(run.status);

  return (
    <section
      className="panel chat-panel"
      id="conversation"
      tabIndex={-1}
      aria-label="Agent conversation"
    >
      <div className="panel-heading">
        <div className="conversation-title">
          <span className="pill-avatars">
            {(selectedAgent ? [selectedAgent] : rows).slice(0, 5).map((row) => (
              <FoldAvatar
                key={row.key}
                {...agentVisual(row.agentRole, row.agentIndex)}
                size={28}
                mood={moodFromTone(row.tone)}
                label={row.name}
              />
            ))}
          </span>
          <div>
            <h2>{selectedAgent ? selectedAgent.name : "Team conversation"}</h2>
            <span>
              {selectedAgent
                ? selectedAgent.role
                : "A shared thread. Independent minds."}
            </span>
          </div>
        </div>
        <span className="count-badge" title="Visible messages">
          {messages.length}
        </span>
      </div>
      <div className="chat-toolbar">
        <SegmentedControl
          aria-label="Filter conversation"
          selectedKeys={selectedAgent ? [] : [filter]}
          onSelectionChange={(keys) => {
            const next = [...keys][0] as ActivityFilter | undefined;
            if (next) {
              onClearSelection();
              setFilter(next);
              setFollow(true);
            }
          }}
        >
          {filters.map((item) => (
            <SegmentedControlItem key={item.value} id={item.value}>
              {item.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {selectedAgent && (
          <Button
            size="xs"
            variant="ghost"
            leadingIcon={icons.close}
            className="selection-clear"
            onClick={onClearSelection}
            aria-label="Clear agent filter"
          >
            {selectedAgent.name}
          </Button>
        )}
      </div>
      <ScrollRegion
        className="chat-scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 64);
        }}
      >
        {run.requirement && !selectedAgent && filter === "all" && (
          <article className="request">
            <div className="request-label">
              <span className="request-avatar">J</span>
              <strong>You</strong>
              <span>THE BRIEF</span>
            </div>
            <p>{run.requirement}</p>
          </article>
        )}
        {messages.length > 0 && (
          <div className="timeline-divider">
            <span />
            {selectedAgent ? "AGENT ACTIVITY" : "RUN ACTIVITY"}
            <span />
          </div>
        )}
        {messages.map((message) => (
          <Bubble key={message.id} message={message} run={run} />
        ))}
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-cluster">
              <FoldAvatar
                {...agentVisual("coordinator", 0)}
                size={66}
                mood="idle"
                label="Kumo"
              />
              <FoldAvatar
                {...agentVisual("worker", 0)}
                size={66}
                mood="idle"
                label="Codex A"
              />
              <FoldAvatar
                {...agentVisual("worker", 1)}
                size={66}
                mood="idle"
                label="Codex B"
              />
            </div>
            <h3>
              {selectedAgent || filter !== "all"
                ? "A little quiet here"
                : "Meet your next great team."}
            </h3>
            <p>
              {selectedAgent || filter !== "all"
                ? "Messages from these agents will appear here."
                : "The conversation will begin when a run starts."}
            </p>
          </div>
        )}
        {terminal && !selectedAgent && filter === "all" && (
          <div className={cx(`run-result tone-${run.status}`)}>
            <span className="result-icon">
              <Icon
                name={run.status === "passed" ? "check" : "activity"}
                size={17}
              />
            </span>
            <div>
              <strong>
                {run.status === "passed"
                  ? "Ready for your review"
                  : run.status === "failed"
                    ? "This run needs attention"
                    : "This run was stopped"}
              </strong>
              <p>
                {run.status === "passed"
                  ? "Tasks verified. Explore the evidence before integrating."
                  : "Review the conversation and evidence for the next step."}
              </p>
            </div>
          </div>
        )}
      </ScrollRegion>
      {!follow && (
        <Button
          size="xs"
          variant="secondary"
          className="jump-latest"
          onClick={() => setFollow(true)}
        >
          Jump to latest ↓
        </Button>
      )}
      <div className="conversation-footer">
        {connection !== "connected" ? (
          <>
            <span className="dot" />
            <span>
              {connection === "connecting"
                ? "Connecting to the run…"
                : "Reconnecting to the run…"}
            </span>
          </>
        ) : run.status === "running" ? (
          <AgentThinking
            variant="wave"
            showTimer={false}
            label={
              activeTasks.length
                ? `${activeTasks.length} ${activeTasks.length === 1 ? "task is" : "tasks are"} in progress`
                : "The team is getting ready"
            }
          />
        ) : (
          <>
            <Icon name="check" size={14} />
            <span>
              {terminal ? "Run activity is up to date" : "Waiting for a run"}
            </span>
          </>
        )}
        <span className="read-only-label">Read-only workspace</span>
      </div>
    </section>
  );
}
