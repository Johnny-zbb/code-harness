import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunSource, discoverRuns, evidenceTypeFor } from '../server/run-source.mjs';

async function makeTempRun() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'harness-run-'));
  const runPath = path.join(root, '.code-harness-runs', 'next-console', 'run-test-001');
  const taskDir = path.join(runPath, 'tasks', 'task-a');
  await fsp.mkdir(taskDir, { recursive: true });

  await fsp.writeFile(
    path.join(runPath, 'plan.json'),
    JSON.stringify({
      name: 'demo plan',
      tasks: [{ id: 'task-a', title: 'Refactor render layer', prompt: '...' }],
    }),
    'utf8',
  );
  await fsp.writeFile(
    path.join(runPath, 'run.json'),
    JSON.stringify({
      runId: 'run-test-001',
      repoRoot: path.join(root, 'next-console'),
      baseRef: 'HEAD',
      startedAt: '2026-09-29T10:00:00Z',
      finishedAt: '2026-09-29T10:01:40Z',
      status: 'passed',
      tasks: [
        {
          id: 'task-a',
          title: 'Refactor render layer',
          branch: 'harness/run-test-001/task-a',
          status: 'passed',
          workerExitCode: 0,
          verifierExitCode: 0,
          startedAt: '2026-09-29T10:00:01Z',
          finishedAt: '2026-09-29T10:01:40Z',
        },
      ],
    }),
    'utf8',
  );
  await fsp.writeFile(
    path.join(taskDir, 'worker-events.jsonl'),
    [
      '{"type":"item.started","item":{"type":"command_execution","command":"npm run typecheck"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Refactor done."}}',
      '',
    ].join('\n'),
    'utf8',
  );
  await fsp.writeFile(path.join(taskDir, 'verifier-events.jsonl'), '{"msg":{"type":"agent_message","message":"Verified."}}\n', 'utf8');
  await fsp.writeFile(path.join(taskDir, 'git-diff.patch'), 'diff --git a/a b/a\n', 'utf8');
  await fsp.writeFile(path.join(taskDir, 'worker.log'), '# command\n', 'utf8');
  await fsp.writeFile(path.join(taskDir, 'worker-prompt.md'), '# Role\n', 'utf8');
  return runPath;
}

test('evidence types map by filename', () => {
  assert.equal(evidenceTypeFor('verification-passed.png'), 'screenshot');
  assert.equal(evidenceTypeFor('git-diff.patch'), 'git-diff');
  assert.equal(evidenceTypeFor('check.log'), 'check');
  assert.equal(evidenceTypeFor('verifier.log'), 'log');
  assert.equal(evidenceTypeFor('worker-events.jsonl'), 'events');
  assert.equal(evidenceTypeFor('notes.txt'), 'file');
});

test('discoverRuns finds runs under repo subdirs and sorts newest first', async () => {
  const runPath = await makeTempRun();
  const runsRoot = path.dirname(path.dirname(runPath));
  const runs = discoverRuns(runsRoot);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, 'run-test-001');
  assert.equal(runs[0].repo, 'next-console');
  assert.equal(runs[0].status, 'passed');
});

test('a completed run replays into a full HarnessEvent sequence', async () => {
  const runPath = await makeTempRun();
  const source = createRunSource(runPath);
  const events = [];
  const handle = source.start((event) => events.push(event));
  await handle.ready;
  handle.cancel();

  const types = events.map((event) => event.type);
  assert.equal(types[0], 'run.started');
  const started = events[0];
  assert.equal(started.runId, 'run-test-001');
  assert.equal(started.repo, 'next-console');
  assert.equal(started.branch, 'HEAD');
  assert.equal(started.requirement, 'demo plan');
  assert.ok(started.startedAt);

  assert.deepEqual(events[1], { type: 'task.started', taskId: 'task-a', title: 'Refactor render layer', attempt: 1 });
  assert.deepEqual(events[2], { type: 'agent.status', taskId: 'task-a', status: 'coding' });
  assert.deepEqual(events[3], { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: 'Refactor done.' });
  assert.deepEqual(events[4], { type: 'agent.status', taskId: 'task-a', status: 'verifying' });
  assert.deepEqual(events[5], { type: 'agent.message', taskId: 'task-a', agent: 'verifier', text: 'Verified.' });

  const evidence = events.filter((event) => event.type === 'evidence.created');
  assert.ok(evidence.some((event) => event.evidenceType === 'git-diff' && event.path === 'tasks/task-a/git-diff.patch'));
  assert.ok(evidence.some((event) => event.evidenceType === 'log'));
  // Prompts are inputs, not evidence.
  assert.ok(!evidence.some((event) => event.path.endsWith('worker-prompt.md')));

  assert.deepEqual(events.at(-1), {
    type: 'run.completed',
    runId: 'run-test-001',
    status: 'passed',
    finishedAt: '2026-09-29T10:01:40Z',
  });
  assert.deepEqual(events.at(-2), { type: 'task.completed', taskId: 'task-a', status: 'passed' });
});

test('a live run streams appended JSONL lines', async () => {
  const runPath = await makeTempRun();
  // Strip the manifest to simulate a run still in progress.
  await fsp.writeFile(
    path.join(runPath, 'run.json'),
    JSON.stringify({ runId: 'run-test-001', repoRoot: '/tmp/next-console', baseRef: 'HEAD', startedAt: '2026-09-29T10:00:00Z', finishedAt: null, tasks: [] }),
    'utf8',
  );
  const taskDir = path.join(runPath, 'tasks', 'task-a');
  await fsp.writeFile(path.join(taskDir, 'worker-events.jsonl'), '{"type":"item.completed","item":{"type":"agent_message","text":"start"}}\n', 'utf8');

  const source = createRunSource(runPath);
  const events = [];
  const handle = source.start((event) => events.push(event));
  await handle.ready;

  await fsp.appendFile(
    path.join(taskDir, 'worker-events.jsonl'),
    '{"type":"item.completed","item":{"type":"agent_message","text":"still working"}}\n',
    'utf8',
  );

  const sawAppended = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (events.some((event) => event.type === 'agent.message' && event.text === 'still working')) return resolve(true);
      if (Date.now() > deadline) return reject(new Error('append never surfaced as an event'));
      setTimeout(check, 100);
    };
    check();
  });
  assert.ok(sawAppended);
  handle.cancel();
});
