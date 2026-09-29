import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { deriveAgentRows, type ChatMessage, type RunState } from '../store';
import { FoldAvatar, agentVisual, moodFromTone, type FoldMood } from './FoldAvatar';
import { TaskCard } from './TaskCard';

function messageMood(message: ChatMessage, run: RunState): FoldMood {
  const task = message.taskId ? run.tasks[message.taskId] : undefined;
  if (task?.status === 'passed') return 'happy';
  if (task?.status === 'failed') return 'sad';
  return 'busy';
}

function Bubble({ message, run }: { message: ChatMessage; run: RunState }) {
  const index = message.taskId ? run.taskOrder.indexOf(message.taskId) : -1;
  const author =
    message.agent === 'coordinator'
      ? 'Kumo'
      : `${message.agent === 'worker' ? 'Codex' : 'Verifier'} ${index >= 0 ? String.fromCharCode(65 + index) : '?'}`;
  return (
    <div class={`bubble agent-${message.agent}`}>
      <div class="bubble-head">
        <FoldAvatar
          {...agentVisual(message.agent, Math.max(0, index))}
          size={24}
          mood={messageMood(message, run)}
          label={author}
        />
        <span class="bubble-author">{author}</span>
        {message.taskId && <span class="bubble-task">{message.taskId}</span>}
      </div>
      <p>{message.text}</p>
    </div>
  );
}

export function AgentChat({ run }: { run: RunState }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [run.messages.length]);

  // BoardUI-style conversation badge: the participating avatars gather here.
  const rows = deriveAgentRows(run);

  // Insert a TaskCard divider before the first message of each task.
  const items: ComponentChildren[] = [];
  let lastTaskId: string | null | undefined = undefined;
  for (const message of run.messages) {
    if (message.taskId !== lastTaskId) {
      lastTaskId = message.taskId;
      const task = message.taskId ? run.tasks[message.taskId] : undefined;
      if (message.taskId && task) {
        items.push(
          <TaskCard
            key={`task-card-${message.taskId}-${task.attempt}`}
            task={task}
            index={run.taskOrder.indexOf(message.taskId)}
          />,
        );
      }
    }
    items.push(<Bubble key={`msg-${message.id}`} message={message} run={run} />);
  }

  const empty = !run.requirement && run.messages.length === 0;

  return (
    <section class="panel chat-panel">
      {run.runId && (
        <div class="conversation-pill">
          <span class="pill-avatars">
            {rows.map((row) => (
              <FoldAvatar
                {...agentVisual(row.agentRole, row.agentIndex)}
                size={20}
                mood={moodFromTone(row.tone)}
                label={row.name}
              />
            ))}
          </span>
          <span>Kumo + {Math.max(0, rows.length - 1)}</span>
        </div>
      )}
      <div class="chat-scroll" ref={scroller}>
        {run.requirement && (
          <div class="bubble user">
            <div class="bubble-head">
              <FoldAvatar {...agentVisual('user', 0)} size={24} mood="idle" label="User" />
              <span class="bubble-author">User</span>
            </div>
            <p>{run.requirement}</p>
          </div>
        )}
        {items}
        {empty && (
          <div class="chat-empty">
            <div class="chat-empty-cluster">
              <FoldAvatar {...agentVisual('coordinator', 0)} size={40} label="Kumo" />
              <FoldAvatar {...agentVisual('worker', 0)} size={40} label="Codex A" />
              <FoldAvatar {...agentVisual('worker', 1)} size={40} label="Codex B" />
              <FoldAvatar {...agentVisual('verifier', 0)} size={40} label="Verifier" />
            </div>
            <p class="chat-empty-title">A few minds. One run.</p>
            <p class="chat-empty-sub">Waiting for the first HarnessEvent…</p>
          </div>
        )}
      </div>
      <div class="composer-hint" title="Step 6 of the control-plane plan wires Start/Stop/Retry into the orchestrator">
        Start / Stop / Retry —— 将在第一次真实 run 后接入（HTTP API 已预留）
      </div>
    </section>
  );
}
