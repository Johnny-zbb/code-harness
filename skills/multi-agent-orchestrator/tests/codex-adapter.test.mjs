import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexArgs, eventFileName } from '../adapters/codex.mjs';

test('Codex args are headless-safe and use stdin', () => {
  assert.deepEqual(buildCodexArgs(), [
    '--ask-for-approval',
    'never',
    'exec',
    '--sandbox',
    'workspace-write',
    '--json',
    '-',
  ]);
});

test('Codex JSONL evidence is role-specific', () => {
  assert.equal(eventFileName('worker'), 'worker-events.jsonl');
  assert.equal(eventFileName('verifier'), 'verifier-events.jsonl');
  assert.throws(() => eventFileName('reviewer'), /Unknown Codex role/);
});
