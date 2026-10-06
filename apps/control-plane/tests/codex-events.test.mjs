import assert from 'node:assert/strict';
import test from 'node:test';
import { mapCodexLine, mapCodexStream } from '../server/codex-events.mjs';

const worker = (line) => mapCodexLine(line, { role: 'worker', taskId: 'task-a' });

test('skips blank, junk, and non-event lines', () => {
  assert.deepEqual(worker(''), []);
  assert.deepEqual(worker('   \n'), []);
  assert.deepEqual(worker('not json at all'), []);
  assert.deepEqual(worker('{"type":"thread.started","thread_id":"th_1"}'), []);
  assert.deepEqual(worker('{"type":"turn.started"}'), []);
  assert.deepEqual(worker('{"type":"turn.completed","usage":{"output_tokens":42}}'), []);
});

test('maps current thread/item stream', () => {
  assert.deepEqual(
    worker('{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"npm test","status":"in_progress"}}'),
    [{ type: 'agent.status', taskId: 'task-a', status: 'coding' }],
  );
  assert.deepEqual(
    worker('{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"npm test","exit_code":0,"status":"completed"}}'),
    [],
  );
  assert.deepEqual(
    worker('{"type":"item.started","item":{"id":"item_1","type":"file_change","changes":[{"path":"src/a.ts","kind":"add"}]}}'),
    [{ type: 'agent.status', taskId: 'task-a', status: 'coding' }],
  );
  assert.deepEqual(
    worker('{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Done."}}'),
    [{ type: 'agent.message', taskId: 'task-a', agent: 'worker', text: 'Done.' }],
  );
  // item.started of an agent message duplicates item.completed; keep one only.
  assert.deepEqual(
    worker('{"type":"item.started","item":{"id":"item_2","type":"agent_message","text":"Done."}}'),
    [],
  );
  // reasoning / todo_list stay out of the stream.
  assert.deepEqual(worker('{"type":"item.completed","item":{"id":"item_3","type":"reasoning","text":"thinking"}}'), []);
});

test('maps verifier role activity to verifying status', () => {
  const verifier = (line) => mapCodexLine(line, { role: 'verifier', taskId: 'task-a' });
  assert.deepEqual(
    verifier('{"type":"item.started","item":{"type":"command_execution","command":"npm test"}}'),
    [{ type: 'agent.status', taskId: 'task-a', status: 'verifying' }],
  );
  assert.deepEqual(
    verifier('{"type":"item.completed","item":{"type":"agent_message","text":"Verification failed: hydration order."}}'),
    [{ type: 'agent.message', taskId: 'task-a', agent: 'verifier', text: 'Verification failed: hydration order.' }],
  );
});

test('maps failures to a message plus failed status', () => {
  assert.deepEqual(worker('{"type":"turn.failed","error":{"message":"boom"}}'), [
    { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: 'Error: boom' },
    { type: 'agent.status', taskId: 'task-a', status: 'failed' },
  ]);
  assert.deepEqual(worker('{"type":"error","message":"stream disconnected"}'), [
    { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: 'Error: stream disconnected' },
    { type: 'agent.status', taskId: 'task-a', status: 'failed' },
  ]);
  assert.deepEqual(worker('{"type":"item.completed","item":{"type":"error","message":"tool crashed"}}'), [
    { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: 'tool crashed' },
  ]);
});

test('maps legacy msg-style stream', () => {
  assert.deepEqual(worker('{"msg":{"type":"task_started"}}'), [
    { type: 'agent.status', taskId: 'task-a', status: 'coding' },
  ]);
  assert.deepEqual(worker('{"msg":{"type":"agent_message","message":"hello"}}'), [
    { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: 'hello' },
  ]);
  assert.deepEqual(worker('{"msg":{"type":"task_complete","last_agent_message":"bye"}}'), []);
});

test('mapCodexStream folds a whole file and tolerates partial trailing lines', () => {
  const raw = [
    'garbage',
    '{"msg":{"type":"task_started"}}',
    '{"msg":{"type":"agent_message","message":"a"}}',
    '{"msg":{"type":"agent_mess', // incomplete trailing write
  ].join('\n');
  assert.deepEqual(mapCodexStream(raw, { role: 'worker', taskId: 't' }), [
    { type: 'agent.status', taskId: 't', status: 'coding' },
    { type: 'agent.message', taskId: 't', agent: 'worker', text: 'a' },
  ]);
});
