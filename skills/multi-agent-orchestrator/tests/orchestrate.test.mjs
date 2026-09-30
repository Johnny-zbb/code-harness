import assert from 'node:assert/strict';
import test from 'node:test';
import { slugify, validatePlan } from '../orchestrate.mjs';

test('slugify produces branch-safe task ids', () => {
  assert.equal(slugify(' Store Refactor / A '), 'store-refactor-a');
});

test('validatePlan accepts one or two independent tasks', () => {
  const plan = {
    tasks: [
      { id: 'a', title: 'A', prompt: 'Do A' },
      { id: 'b', title: 'B', prompt: 'Do B' },
    ],
  };
  assert.equal(validatePlan(plan), plan);
});

test('validatePlan rejects more than two tasks', () => {
  assert.throws(
    () => validatePlan({ tasks: [
      { id: 'a', title: 'A', prompt: 'A' },
      { id: 'b', title: 'B', prompt: 'B' },
      { id: 'c', title: 'C', prompt: 'C' },
    ] }),
    /at most 2 tasks/,
  );
});

test('validatePlan rejects dependent tasks in the MVP', () => {
  assert.throws(
    () => validatePlan({ tasks: [{ id: 'b', title: 'B', prompt: 'B', dependsOn: ['a'] }] }),
    /independent tasks/,
  );
});
