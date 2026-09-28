#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MAX_MVP_TASKS = 2;

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { command, options };
}

export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Plan must be a JSON object.');
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error('Plan must contain at least one task.');
  if (plan.tasks.length > MAX_MVP_TASKS) throw new Error(`MVP supports at most ${MAX_MVP_TASKS} tasks.`);

  const seen = new Set();
  for (const [index, task] of plan.tasks.entries()) {
    if (!task || typeof task !== 'object') throw new Error(`Task ${index + 1} must be an object.`);
    for (const field of ['id', 'title', 'prompt']) {
      if (typeof task[field] !== 'string' || !task[field].trim()) {
        throw new Error(`Task ${index + 1} is missing non-empty \`${field}\`.`);
      }
    }
    const id = slugify(task.id);
    if (seen.has(id)) throw new Error(`Duplicate task id after normalization: ${id}`);
    seen.add(id);
    if (task.dependsOn?.length) {
      throw new Error('This MVP only accepts independent tasks; remove dependsOn or run sequentially.');
    }
  }
  return plan;
}

function run(command, { cwd, env = {}, stdin = '', logFile, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const value = chunk.toString();
      stdout += value;
      if (!quiet) process.stdout.write(value);
    });
    child.stderr.on('data', (chunk) => {
      const value = chunk.toString();
      stderr += value;
      if (!quiet) process.stderr.write(value);
    });
    child.on('error', reject);
    child.on('close', async (code) => {
      if (logFile) {
        await fs.mkdir(path.dirname(logFile), { recursive: true });
        await fs.writeFile(logFile, `# command\n${command}\n\n# stdout\n${stdout}\n\n# stderr\n${stderr}\n`, 'utf8');
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function git(args, cwd, quiet = true) {
  const quoted = args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(' ');
  const result = await run(`git ${quoted}`, { cwd, quiet });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

async function resolveRepo(input) {
  const candidate = path.resolve(input || process.cwd());
  const root = await git(['rev-parse', '--show-toplevel'], candidate);
  return path.resolve(root);
}

function makeRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `run-${stamp}-${process.pid}`;
}

function workerPrompt(task) {
  return [
    '# Role',
    'You are a coding worker operating inside an isolated git worktree.',
    '',
    '# Task',
    task.prompt.trim(),
    '',
    '# Constraints',
    '- Work only on this task; avoid unrelated refactors.',
    '- Follow the repository instructions and use pstack rigor when available.',
    '- Verify the real behavior, not only compilation.',
    '- Do not create or remove git worktrees.',
    '- Do not merge branches.',
    '- Leave the worktree in a reviewable state.',
  ].join('\n');
}

function verifierPrompt(task) {
  return [
    '# Role',
    'You are an independent verifier. You did not author this change.',
    '',
    '# Task under verification',
    `${task.title}: ${task.prompt.trim()}`,
    '',
    '# Verification contract',
    '- Use pstack and the project verification skill when available.',
    '- Inspect the diff and reproduce the intended behavior independently.',
    '- Run the strongest relevant deterministic checks available.',
    '- Do not fix production code. If verification fails, report failure and evidence.',
    '- Prefer machine-readable evidence and concrete artifacts over claims.',
  ].join('\n');
}

async function captureGitState(worktree, evidenceDir) {
  const [status, diffStat, diff] = await Promise.all([
    git(['status', '--short'], worktree).catch((error) => `ERROR: ${error.message}`),
    git(['diff', '--stat'], worktree).catch((error) => `ERROR: ${error.message}`),
    git(['diff'], worktree).catch((error) => `ERROR: ${error.message}`),
  ]);
  await fs.writeFile(path.join(evidenceDir, 'git-status.txt'), `${status}\n`, 'utf8');
  await fs.writeFile(path.join(evidenceDir, 'git-diff-stat.txt'), `${diffStat}\n`, 'utf8');
  await fs.writeFile(path.join(evidenceDir, 'git-diff.patch'), `${diff}\n`, 'utf8');
}

async function executeTask({ task, repoRoot, baseSha, runId, runRoot, workerCommand, verifierCommand, checkCommand, dryRun }) {
  const id = slugify(task.id);
  const branch = `harness/${runId}/${id}`;
  const worktreeRoot = path.join(path.dirname(repoRoot), '.code-harness-worktrees', path.basename(repoRoot), runId);
  const worktree = path.join(worktreeRoot, id);
  const evidenceDir = path.join(runRoot, 'tasks', id);
  await fs.mkdir(evidenceDir, { recursive: true });

  const worker = workerPrompt(task);
  const verifier = verifierPrompt(task);
  await fs.writeFile(path.join(evidenceDir, 'worker-prompt.md'), worker, 'utf8');
  await fs.writeFile(path.join(evidenceDir, 'verifier-prompt.md'), verifier, 'utf8');

  const result = {
    id,
    title: task.title,
    branch,
    worktree,
    status: 'running',
    workerExitCode: null,
    verifierExitCode: null,
    checkExitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  if (dryRun) {
    result.status = 'dry-run';
    result.finishedAt = new Date().toISOString();
    return result;
  }

  await fs.mkdir(worktreeRoot, { recursive: true });
  const exists = await fs.access(worktree).then(() => true).catch(() => false);
  if (exists) throw new Error(`Worktree path already exists: ${worktree}`);

  await git(['worktree', 'add', '-b', branch, worktree, baseSha], repoRoot, false);

  const commonEnv = {
    HARNESS_RUN_ID: runId,
    HARNESS_TASK_ID: id,
    HARNESS_TASK_TITLE: task.title,
    HARNESS_REPO_ROOT: repoRoot,
    HARNESS_WORKTREE: worktree,
    HARNESS_EVIDENCE_DIR: evidenceDir,
    HARNESS_WORKER_PROMPT_FILE: path.join(evidenceDir, 'worker-prompt.md'),
    HARNESS_VERIFIER_PROMPT_FILE: path.join(evidenceDir, 'verifier-prompt.md'),
  };

  const workerResult = await run(workerCommand, {
    cwd: worktree,
    env: commonEnv,
    stdin: worker,
    logFile: path.join(evidenceDir, 'worker.log'),
  });
  result.workerExitCode = workerResult.code;

  if (workerResult.code !== 0) {
    result.status = 'worker-failed';
    await captureGitState(worktree, evidenceDir);
    result.finishedAt = new Date().toISOString();
    return result;
  }

  if (verifierCommand) {
    const verifierResult = await run(verifierCommand, {
      cwd: worktree,
      env: commonEnv,
      stdin: verifier,
      logFile: path.join(evidenceDir, 'verifier.log'),
    });
    result.verifierExitCode = verifierResult.code;
    if (verifierResult.code !== 0) {
      result.status = 'verification-failed';
      await captureGitState(worktree, evidenceDir);
      result.finishedAt = new Date().toISOString();
      return result;
    }
  }

  if (checkCommand) {
    const checkResult = await run(checkCommand, {
      cwd: worktree,
      env: commonEnv,
      logFile: path.join(evidenceDir, 'check.log'),
    });
    result.checkExitCode = checkResult.code;
    if (checkResult.code !== 0) {
      result.status = 'check-failed';
      await captureGitState(worktree, evidenceDir);
      result.finishedAt = new Date().toISOString();
      return result;
    }
  }

  await captureGitState(worktree, evidenceDir);
  result.status = 'passed';
  result.finishedAt = new Date().toISOString();
  return result;
}

function printHelp() {
  console.log(`multi-agent-orchestrator (MVP)

Usage:
  node orchestrate.mjs doctor [--repo <path>]
  node orchestrate.mjs run --plan <plan.json> --worker-command <command> [options]

Options:
  --repo <path>                 Target git repository (default: cwd)
  --plan <path>                 JSON plan with 1-2 independent tasks
  --worker-command <command>    Coding agent command; prompt is sent on stdin
  --verifier-command <command>  Independent verifier command; prompt is sent on stdin
  --check-command <command>     Deterministic verification command after verifier
  --max-parallel <1|2>          Concurrency cap (default: 2)
  --dry-run                     Validate and print the execution plan only

Injected environment variables:
  HARNESS_RUN_ID, HARNESS_TASK_ID, HARNESS_TASK_TITLE, HARNESS_REPO_ROOT,
  HARNESS_WORKTREE, HARNESS_EVIDENCE_DIR, HARNESS_WORKER_PROMPT_FILE,
  HARNESS_VERIFIER_PROMPT_FILE
`);
}

async function doctor(options) {
  const repoRoot = await resolveRepo(options.repo);
  const nodeVersion = process.version;
  const gitVersion = await git(['--version'], repoRoot);
  const branch = await git(['branch', '--show-current'], repoRoot);
  const head = await git(['rev-parse', 'HEAD'], repoRoot);
  console.log(JSON.stringify({ ok: true, repoRoot, nodeVersion, gitVersion, branch, head, platform: os.platform() }, null, 2));
}

async function runPlan(options) {
  if (!options.plan) throw new Error('--plan is required.');
  if (!options['worker-command'] && !options['dry-run']) throw new Error('--worker-command is required unless --dry-run is used.');

  const repoRoot = await resolveRepo(options.repo);
  const planPath = path.resolve(options.plan);
  const plan = validatePlan(JSON.parse(await fs.readFile(planPath, 'utf8')));
  const maxParallel = Number(options['max-parallel'] || 2);
  if (![1, 2].includes(maxParallel)) throw new Error('--max-parallel must be 1 or 2 for the MVP.');

  const baseRef = plan.baseRef || 'HEAD';
  const baseSha = await git(['rev-parse', baseRef], repoRoot);
  const runId = makeRunId();
  const runRoot = path.join(path.dirname(repoRoot), '.code-harness-runs', path.basename(repoRoot), runId);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.copyFile(planPath, path.join(runRoot, 'plan.json'));

  const manifest = {
    runId,
    repoRoot,
    baseRef,
    baseSha,
    maxParallel,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tasks: [],
  };
  await fs.writeFile(path.join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2), 'utf8');

  if (options['dry-run']) {
    console.log(JSON.stringify({ ...manifest, dryRun: true, plannedTasks: plan.tasks.map((task) => ({ id: slugify(task.id), title: task.title })) }, null, 2));
    return;
  }

  const queue = [...plan.tasks];
  const running = new Set();
  const results = [];

  async function startTask(task) {
    const promise = executeTask({
      task,
      repoRoot,
      baseSha,
      runId,
      runRoot,
      workerCommand: options['worker-command'],
      verifierCommand: options['verifier-command'] || '',
      checkCommand: options['check-command'] || '',
      dryRun: false,
    })
      .then((result) => results.push(result))
      .catch((error) => results.push({ id: slugify(task.id), title: task.title, status: 'orchestrator-failed', error: error.message }))
      .finally(() => running.delete(promise));
    running.add(promise);
  }

  while (queue.length || running.size) {
    while (queue.length && running.size < maxParallel) {
      await startTask(queue.shift());
    }
    if (running.size) await Promise.race([...running]);
  }

  manifest.tasks = results.sort((a, b) => a.id.localeCompare(b.id));
  manifest.finishedAt = new Date().toISOString();
  manifest.status = manifest.tasks.every((task) => task.status === 'passed') ? 'passed' : 'failed';
  await fs.writeFile(path.join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`\nRun evidence: ${runRoot}`);
  console.log(JSON.stringify(manifest, null, 2));
  if (manifest.status !== 'passed') process.exitCode = 1;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help' || command === '--help' || command === '-h') return printHelp();
  if (command === 'doctor') return doctor(options);
  if (command === 'run') return runPlan(options);
  throw new Error(`Unknown command: ${command}`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[multi-agent-orchestrator] ${error.message}`);
    process.exitCode = 1;
  });
}
