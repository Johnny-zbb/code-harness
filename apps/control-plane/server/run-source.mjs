/**
 * Adapter: on-disk harness run dirs -> HarnessEvent stream.
 *
 * A run lives under `<sibling-of-repo>/.code-harness-runs/<repo>/<run-id>/`:
 *   plan.json            task ids/titles (known before run.json fills in)
 *   run.json             manifest, rewritten with final tasks at the end
 *   tasks/<task-id>/     worker-events.jsonl, verifier-events.jsonl, logs,
 *                        git evidence, screenshots
 *
 * start(emit) replays everything found so far, then tails the JSONL streams
 * and evidence files via fs.watch + a poll safety net until cancelled.
 * Event sources share one contract: start(emit) -> { ready, cancel }.
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { mapCodexStream } from './codex-events.mjs';

// Mirror of skills/multi-agent-orchestrator/orchestrate.mjs slugify so the
// control-plane stays dependency-free and does not import kernel code.
export function slugify(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task'
  );
}

const PROMPT_FILES = new Set(['worker-prompt.md', 'verifier-prompt.md']);

export function evidenceTypeFor(filename) {
  if (/\.(png|jpe?g|webp|gif)$/i.test(filename)) return 'screenshot';
  if (filename === 'git-diff.patch') return 'git-diff';
  if (filename === 'git-diff-stat.txt') return 'git-diff-stat';
  if (filename === 'git-status.txt') return 'git-status';
  if (filename === 'check.log') return 'check';
  if (filename.endsWith('.log')) return 'log';
  if (filename.endsWith('.jsonl')) return 'events';
  return 'file';
}

export function finalTaskStatus(manifestTask) {
  if (manifestTask?.status === 'passed') return 'passed';
  if (
    ['worker-failed', 'verification-failed', 'check-failed', 'orchestrator-failed'].includes(
      manifestTask?.status,
    )
  ) {
    return 'failed';
  }
  return null;
}

/** Scan `.code-harness-runs/` (either at the root or inside a repo subdir). */
export function discoverRuns(runsDir) {
  const root = path.resolve(runsDir);
  const runs = [];
  const collect = (runPath) => {
    if (!fs.existsSync(path.join(runPath, 'run.json'))) return;
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(runPath, 'run.json'), 'utf8'));
    } catch {
      // Partial write; still list it, status unknown.
    }
    runs.push({
      runId: manifest?.runId || path.basename(runPath),
      repo: manifest?.repoRoot ? path.basename(manifest.repoRoot) : path.basename(path.dirname(runPath)),
      status: manifest?.finishedAt ? (manifest.status ?? 'unknown') : 'running',
      startedAt: manifest?.startedAt ?? null,
      path: runPath,
    });
  };

  let topLevel = [];
  try {
    topLevel = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return runs;
  }

  for (const entry of topLevel) {
    const child = path.join(root, entry.name);
    if (fs.existsSync(path.join(child, 'run.json'))) {
      collect(child);
      continue;
    }
    let nested = [];
    try {
      nested = fs.readdirSync(child, { withFileTypes: true }).filter((item) => item.isDirectory());
    } catch {
      continue;
    }
    for (const item of nested) collect(path.join(child, item.name));
  }

  return runs.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
}

export function createRunSource(runPath) {
  const runRoot = path.resolve(runPath);
  const streamState = new Map(); // relPath -> { offset, buffer }
  const evidenceSeen = new Set();
  const taskMeta = new Map(); // taskId -> { title, lastStatus }
  let manifest = null;
  let plan = null;
  let completionEmitted = false;

  async function readJsonSafe(file) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  function repoName() {
    if (manifest?.repoRoot) return path.basename(manifest.repoRoot);
    return path.basename(path.dirname(runRoot));
  }

  async function resolveTasks() {
    const tasks = [];
    const seen = new Set();
    const push = (id, title) => {
      const slug = slugify(id);
      if (seen.has(slug)) return;
      seen.add(slug);
      tasks.push({ id: slug, title: title || slug });
    };
    for (const task of plan?.tasks ?? []) push(task.id, task.title);
    for (const task of manifest?.tasks ?? []) push(task.id, task.title);
    let dirs = [];
    try {
      dirs = await fsp.readdir(path.join(runRoot, 'tasks'), { withFileTypes: true });
    } catch {
      // No task output yet.
    }
    for (const dir of dirs) if (dir.isDirectory()) push(dir.name, dir.name);
    return tasks;
  }

  function sendTaskStatus(emit, taskId, status) {
    const meta = taskMeta.get(taskId);
    if (!meta || meta.lastStatus === status) return;
    meta.lastStatus = status;
    emit({ type: 'agent.status', taskId, status });
  }

  function ensureTaskStarted(emit, taskId, title) {
    if (taskMeta.has(taskId)) {
      const meta = taskMeta.get(taskId);
      if (title && title !== taskId && meta.title === taskId) {
        meta.title = title;
        emit({ type: 'task.started', taskId, title, attempt: 1 });
      }
      return;
    }
    taskMeta.set(taskId, { title: title || taskId, lastStatus: 'queued' });
    emit({ type: 'task.started', taskId, title: title || taskId, attempt: 1 });
  }

  async function tailStream(emit, relPath, role, taskId) {
    const abs = path.join(runRoot, ...relPath.split('/'));
    let text;
    try {
      text = await fsp.readFile(abs, 'utf8');
    } catch {
      return;
    }
    let state = streamState.get(relPath);
    if (!state) {
      state = { offset: 0, buffer: '' };
      streamState.set(relPath, state);
    }
    if (text.length < state.offset) state.offset = 0; // rewritten/truncated
    const chunk = text.slice(state.offset);
    if (!chunk) return;
    state.offset = text.length;
    const data = state.buffer + chunk;
    const lines = data.split('\n');
    state.buffer = lines.pop() ?? '';
    if (!lines.length) return;

    // First activity on a stream moves the task out of queued.
    sendTaskStatus(emit, taskId, role === 'verifier' ? 'verifying' : 'coding');
    for (const event of mapCodexStream(lines.join('\n') + '\n', { role, taskId })) {
      if (event.type === 'agent.status') sendTaskStatus(emit, taskId, event.status);
      else emit(event);
    }
  }

  async function emitTaskEvidence(emit, taskId) {
    const taskDir = path.join(runRoot, 'tasks', taskId);
    let entries = [];
    try {
      entries = await fsp.readdir(taskDir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (PROMPT_FILES.has(name)) continue;
      const rel = `tasks/${taskId}/${name}`;
      if (evidenceSeen.has(rel)) continue;
      const stat = await fsp.stat(path.join(taskDir, name)).catch(() => null);
      if (!stat?.isFile()) continue;
      evidenceSeen.add(rel);
      emit({
        type: 'evidence.created',
        taskId,
        evidenceType: evidenceTypeFor(name),
        path: rel,
        label: name,
      });
    }
  }

  async function maybeEmitCompletion(emit) {
    if (completionEmitted || !manifest?.finishedAt) return;
    const runId = manifest.runId || path.basename(runRoot);
    for (const task of manifest.tasks ?? []) {
      const final = finalTaskStatus(task);
      if (!final) continue;
      ensureTaskStarted(emit, task.id, task.title);
      const meta = taskMeta.get(task.id);
      const verificationRan = task.verifierExitCode != null || meta.lastStatus === 'verifying';
      if (verificationRan && meta.lastStatus === 'coding') {
        sendTaskStatus(emit, task.id, 'verifying');
      }
      emit({ type: 'agent.status', taskId: task.id, status: final });
      emit({ type: 'task.completed', taskId: task.id, status: final });
      meta.lastStatus = final;
    }
    emit({
      type: 'run.completed',
      runId,
      status: manifest.status === 'passed' ? 'passed' : manifest.status === 'failed' ? 'failed' : 'stopped',
      finishedAt: manifest.finishedAt,
    });
    completionEmitted = true;
  }

  async function scanAll(emit) {
    if (!plan) plan = await readJsonSafe(path.join(runRoot, 'plan.json'));
    manifest = (await readJsonSafe(path.join(runRoot, 'run.json'))) || manifest;

    for (const task of await resolveTasks()) {
      ensureTaskStarted(emit, task.id, task.title);
      await tailStream(emit, `tasks/${task.id}/worker-events.jsonl`, 'worker', task.id);
      await tailStream(emit, `tasks/${task.id}/verifier-events.jsonl`, 'verifier', task.id);
      await emitTaskEvidence(emit, task.id);
    }
    await maybeEmitCompletion(emit);
  }

  return {
    meta() {
      return {
        runId: manifest?.runId || path.basename(runRoot),
        repo: repoName(),
        status: manifest?.finishedAt ? (manifest.status ?? 'unknown') : 'running',
        startedAt: manifest?.startedAt ?? null,
        path: runRoot,
      };
    },
    start(emit) {
      let cancelled = false;
      let readyResolve;
      const ready = new Promise((resolve) => {
        readyResolve = resolve;
      });

      const guarded = (event) => {
        if (!cancelled) emit(event);
      };

      // run.started leads every replay; task/evidence events follow via scanAll.
      const initial = (async () => {
        if (!plan) plan = await readJsonSafe(path.join(runRoot, 'plan.json'));
        manifest = (await readJsonSafe(path.join(runRoot, 'run.json'))) || manifest;
        guarded({
          type: 'run.started',
          runId: manifest?.runId || path.basename(runRoot),
          repo: repoName(),
          branch: manifest?.baseRef || undefined,
          requirement: plan?.requirement || plan?.name || undefined,
          startedAt: manifest?.startedAt || new Date().toISOString(),
        });
        await scanAll(guarded);
      })().finally(readyResolve);

      const schedule = (() => {
        let timer = null;
        return () => {
          if (timer || cancelled) return;
          timer = setTimeout(() => {
            timer = null;
            initial
              .then(() => scanAll(guarded))
              .catch(() => {});
          }, 250);
        };
      })();

      let watcher;
      try {
        watcher = fs.watch(runRoot, { recursive: true }, (_event, filename) => {
          if (filename) schedule();
        });
      } catch {
        // Poll-only fallback if recursive watching is unavailable.
      }
      const poll = setInterval(schedule, 2000);

      return {
        ready,
        cancel() {
          cancelled = true;
          watcher?.close();
          clearInterval(poll);
        },
      };
    },
  };
}
