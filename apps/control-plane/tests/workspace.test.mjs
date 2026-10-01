import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual TS modules without requiring Node's newer TS loader.
async function loadModule(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { applyEvent, initialRunState, deriveAgentRows, deriveMetrics, formatElapsed } = await loadModule('../src/store.ts');
const { selectMessages } = await loadModule('../src/activity.ts');
const { connectHarnessEvents } = await loadModule('../src/adapters/harness-events.ts');

function fold(events) { return events.reduce(applyEvent, initialRunState); }

test('agent filters distinguish worker and verifier identities and preserve coordinator task messages', () => {
  const state = fold([
    { type: 'run.started', runId: 'run-1' },
    { type: 'task.started', taskId: 'a' },
    { type: 'task.started', taskId: 'b' },
    { type: 'agent.message', agent: 'coordinator', text: 'Plan' },
    { type: 'agent.message', taskId: 'a', agent: 'worker', text: 'Build A' },
    { type: 'agent.message', taskId: 'b', agent: 'worker', text: 'Build B' },
    { type: 'agent.message', taskId: 'a', agent: 'verifier', text: 'Check A' },
    { type: 'agent.message', taskId: 'b', agent: 'verifier', text: 'Check B' },
    { type: 'agent.message', taskId: 'a', agent: 'coordinator', text: 'Retry A' },
  ]);
  const rows = deriveAgentRows(state);
  const texts = (filter, key = null) => selectMessages(state.messages, filter, rows.find((row) => row.key === key) ?? null).map((message) => message.text);
  assert.deepEqual(texts('all'), ['Plan', 'Build A', 'Build B', 'Check A', 'Check B', 'Retry A']);
  assert.deepEqual(texts('worker'), ['Build A', 'Build B']);
  assert.deepEqual(texts('verifier'), ['Check A', 'Check B']);
  assert.deepEqual(texts('all', 'worker-a'), ['Build A']);
  assert.deepEqual(texts('worker', 'verifier-b'), ['Check B']);
  assert.deepEqual(texts('all', 'coordinator'), ['Plan', 'Retry A']);
});

test('a verifier stays selectable while its worker retries without showing a failed state', () => {
  const state = fold([
    { type: 'task.started', taskId: 'a' },
    { type: 'agent.status', taskId: 'a', status: 'verifying' },
    { type: 'agent.message', taskId: 'a', agent: 'verifier', text: 'Rejected' },
    { type: 'task.completed', taskId: 'a', status: 'failed' },
    { type: 'task.started', taskId: 'a', attempt: 2 },
    { type: 'agent.status', taskId: 'a', status: 'coding' },
  ]);
  const verifier = deriveAgentRows(state).find((row) => row.key === 'verifier-a');
  assert.equal(verifier.taskId, 'a');
  assert.equal(verifier.statusLabel, 'Waiting');
  assert.equal(verifier.tone, 'idle');
  assert.equal(deriveMetrics(state).retries, 1);
});

test('timestamps survive the event fold and the timer freezes when a run finishes', () => {
  const state = fold([
    { type: 'run.started', runId: 'run-1', startedAt: '2026-09-30T12:00:00Z' },
    { type: 'agent.message', agent: 'coordinator', text: 'Done', ts: '2026-09-30T12:01:00Z' },
    { type: 'run.completed', runId: 'run-1', status: 'passed', finishedAt: '2026-09-30T12:01:42Z' },
  ]);
  assert.equal(state.messages[0].ts, '2026-09-30T12:01:00Z');
  assert.equal(formatElapsed(state.startedAt, state.completedAt, Date.parse('2026-09-30T13:00:00Z')), '1m 42s');
});

test('named checks are distinct and retried artifacts update their label without duplicating files', () => {
  const state = fold([
    { type: 'task.started', taskId: 'a' },
    { type: 'evidence.created', taskId: 'a', evidenceType: 'check', path: '', label: 'typecheck' },
    { type: 'evidence.created', taskId: 'a', evidenceType: 'check', path: '', label: 'eslint' },
    { type: 'evidence.created', taskId: 'a', evidenceType: 'check', path: '', label: 'typecheck' },
    { type: 'evidence.created', taskId: 'a', evidenceType: 'git-diff', path: 'diff.patch' },
    { type: 'evidence.created', taskId: 'a', evidenceType: 'git-diff', path: 'diff.patch', label: 'diff.patch (attempt 2)' },
  ]);
  assert.equal(state.tasks.a.evidence.length, 3);
  assert.deepEqual(state.tasks.a.evidence.map((item) => item.label), ['typecheck', 'eslint', 'diff.patch (attempt 2)']);
});

test('SSE reconnect resets before replay, reports connection states, and closes on disposal', (context) => {
  let instance;
  class FakeEventSource {
    constructor(url) { this.url = url; instance = this; }
    close() { this.closed = true; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
  Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'EventSource', original);
    else delete globalThis.EventSource;
  });
  const observations = [];
  const disconnect = connectHarnessEvents(() => observations.push('reset'), (event) => observations.push(event.type), (state) => observations.push(state));
  assert.equal(instance.url, '/api/events');
  instance.onopen();
  instance.onmessage({ data: 'broken frame' });
  instance.onmessage({ data: JSON.stringify({ type: 'run.started', runId: 'one' }) });
  instance.onerror();
  instance.onopen();
  instance.onmessage({ data: JSON.stringify({ type: 'run.started', runId: 'two' }) });
  assert.deepEqual(observations, ['connecting', 'reset', 'connected', 'run.started', 'reconnecting', 'reset', 'connected', 'run.started']);
  disconnect();
  assert.equal(instance.closed, true);
});
