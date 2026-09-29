import { useEffect, useReducer } from 'preact/hooks';
import { connectHarnessEvents } from './adapters/harness-events';
import { AgentChat } from './components/AgentChat';
import { AgentList } from './components/AgentList';
import { EvidencePanel } from './components/EvidencePanel';
import { RunHeader } from './components/RunHeader';
import { applyEvent, initialRunState, type RunState } from './store';
import type { HarnessEvent } from './types';

type Action = { type: 'reset' } | { type: 'event'; event: HarnessEvent };

function reducer(state: RunState, action: Action): RunState {
  if (action.type === 'reset') return initialRunState;
  return applyEvent(state, action.event);
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialRunState);

  useEffect(
    () =>
      connectHarnessEvents(
        () => dispatch({ type: 'reset' }),
        (event) => dispatch({ type: 'event', event }),
      ),
    [],
  );

  return (
    <div class="app">
      <RunHeader run={state} />
      <main class="columns">
        <AgentList run={state} />
        <AgentChat run={state} />
        <EvidencePanel run={state} />
      </main>
    </div>
  );
}
