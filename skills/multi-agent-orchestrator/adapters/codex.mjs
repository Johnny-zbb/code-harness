#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function buildCodexArgs() {
  return [
    '--ask-for-approval',
    'never',
    'exec',
    '--sandbox',
    'workspace-write',
    '--json',
    '-',
  ];
}

export function eventFileName(role) {
  if (role === 'worker') return 'worker-events.jsonl';
  if (role === 'verifier') return 'verifier-events.jsonl';
  throw new Error(`Unknown Codex role: ${role}`);
}

function shellQuote(value) {
  const text = String(value);
  if (process.platform === 'win32') return `"${text.replace(/"/g, '""')}"`;
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

async function runCodex(role) {
  const prompt = await readStdin();
  if (!prompt.trim()) throw new Error('Codex adapter received an empty prompt on stdin.');

  const codexBin = process.env.CODEX_BIN || 'codex';
  const evidenceDir = process.env.HARNESS_EVIDENCE_DIR;
  const eventsPath = evidenceDir ? path.join(evidenceDir, eventFileName(role)) : null;
  let eventsStream = null;

  if (eventsPath) {
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    eventsStream = createWriteStream(eventsPath, { encoding: 'utf8' });
  }

  const child = spawn(codexBin, buildCodexArgs(), {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    eventsStream?.write(chunk);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.stdin.end(prompt);

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
  });

  eventsStream?.end();
  process.exitCode = code;
}

async function doctor() {
  const codexBin = process.env.CODEX_BIN || 'codex';
  const child = spawn(codexBin, ['--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
  });

  if (code !== 0) throw new Error(stderr.trim() || `Codex exited with code ${code}`);
  console.log(JSON.stringify({ ok: true, codex: stdout.trim(), binary: codexBin }, null, 2));
}

async function runOrchestrator(args) {
  const adapterPath = fileURLToPath(import.meta.url);
  const orchestratorPath = path.resolve(path.dirname(adapterPath), '..', 'orchestrate.mjs');
  const workerCommand = `${shellQuote(process.execPath)} ${shellQuote(adapterPath)} worker`;
  const verifierCommand = `${shellQuote(process.execPath)} ${shellQuote(adapterPath)} verifier`;

  const forwarded = [...args];
  const noVerifierIndex = forwarded.indexOf('--no-verifier');
  const noVerifier = noVerifierIndex !== -1;
  if (noVerifier) forwarded.splice(noVerifierIndex, 1);

  const orchestratorArgs = [
    orchestratorPath,
    'run',
    ...forwarded,
    '--worker-command',
    workerCommand,
  ];

  if (!noVerifier) orchestratorArgs.push('--verifier-command', verifierCommand);

  const child = spawn(process.execPath, orchestratorArgs, {
    stdio: 'inherit',
    shell: false,
  });

  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
  });

  process.exitCode = code;
}

function printHelp() {
  console.log(`Codex adapter for multi-agent-orchestrator

Usage:
  node adapters/codex.mjs doctor
  node adapters/codex.mjs run --repo <path> --plan <plan.json> [orchestrator options]

Examples:
  node adapters/codex.mjs run --repo ../next-console --plan ./plan.json --check-command "npm test"
  node adapters/codex.mjs run --repo ../next-console --plan ./plan.json --no-verifier

Environment:
  CODEX_BIN   Override the Codex executable path (default: codex)
`);
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);

  if (command === 'worker' || command === 'verifier') return runCodex(command);
  if (command === 'doctor') return doctor();
  if (command === 'run') return runOrchestrator(args);
  if (command === 'help' || command === '--help' || command === '-h') return printHelp();

  throw new Error(`Unknown command: ${command}`);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[codex-adapter] ${error.message}`);
    process.exitCode = 1;
  });
}
