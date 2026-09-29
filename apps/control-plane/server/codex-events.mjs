/**
 * Codex JSONL -> HarnessEvent mapping.
 *
 * Codex CLI `exec --json` has shipped a couple of event shapes over time:
 * the current thread/turn/item stream and an older `{"msg": {...}}` stream.
 * The mapper is intentionally defensive: unknown or unparseable lines are
 * skipped so a schema drift degrades the UI instead of breaking it.
 */

export function mapCodexLine(line, { role = 'worker', taskId } = {}) {
  const events = [];
  const text = String(line ?? '').trim();
  if (!text) return events;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return events;
  }
  if (!parsed || typeof parsed !== 'object') return events;

  const agent = role === 'verifier' ? 'verifier' : 'worker';
  const activityStatus = role === 'verifier' ? 'verifying' : 'coding';

  const pushMessage = (message) => {
    if (typeof message === 'string' && message.trim()) {
      events.push({ type: 'agent.message', taskId, agent, text: message });
    }
  };

  // Current shape: {"type":"item.started|item.completed|item.updated","item":{...}}
  if (parsed.type === 'item.started' || parsed.type === 'item.completed' || parsed.type === 'item.updated') {
    const item = parsed.item ?? {};
    switch (item.type) {
      case 'agent_message':
        // `item.started` duplicates the text of `item.completed`; keep one.
        if (parsed.type === 'item.completed') pushMessage(item.text);
        break;
      case 'command_execution':
      case 'file_change':
        if (parsed.type === 'item.started') {
          events.push({ type: 'agent.status', taskId, status: activityStatus });
        }
        break;
      case 'error':
        if (parsed.type === 'item.completed') pushMessage(item.message);
        break;
      default:
        // reasoning, todo_list, mcp_tool_call, ... stay out of the v1 stream.
        break;
    }
    return events;
  }

  // Legacy shape: {"msg":{"type":"agent_message","message":"..."}}
  if (parsed.msg && typeof parsed.msg === 'object') {
    if (parsed.msg.type === 'agent_message') pushMessage(parsed.msg.message);
    if (parsed.msg.type === 'task_started') {
      events.push({ type: 'agent.status', taskId, status: activityStatus });
    }
    return events;
  }

  if (parsed.type === 'turn.failed' || parsed.type === 'error') {
    const message = parsed.error?.message ?? parsed.message ?? `${parsed.type} occurred`;
    pushMessage(`Error: ${message}`);
    events.push({ type: 'agent.status', taskId, status: 'failed' });
    return events;
  }

  return events;
}

export function mapCodexStream(text, context) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    events.push(...mapCodexLine(line, context));
  }
  return events;
}
