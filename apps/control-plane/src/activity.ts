import type { AgentRow, ChatMessage } from './store';

export type ActivityFilter = 'all' | 'worker' | 'verifier';

/** Agent identity includes the task: two workers can share a backend role. */
export function selectMessages(messages: ChatMessage[], filter: ActivityFilter, agent: AgentRow | null): ChatMessage[] {
  return messages.filter((message) => {
    if (agent) return message.agent === agent.agentRole && (agent.agentRole === 'coordinator' || message.taskId === agent.taskId);
    return filter === 'all' || message.agent === filter;
  });
}
