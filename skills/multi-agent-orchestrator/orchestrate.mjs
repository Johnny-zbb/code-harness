#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_MVP_TASKS = 2;
const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { command, options };
}

export function slugify(value) {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "task"
  );
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object")
    throw new Error("Plan must be a JSON object.");
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0)
    throw new Error("Plan must contain at least one task.");
  if (plan.tasks.length > MAX_MVP_TASKS)
    throw new Error(`MVP supports at most ${MAX_MVP_TASKS} tasks.`);

  const seen = new Set();
  for (const [index, task] of plan.tasks.entries()) {
    if (!task || typeof task !== "object")
      throw new Error(`Task ${index + 1} must be an object.`);
    for (const field of ["id", "title", "prompt"]) {
      if (typeof task[field] !== "string" || !task[field].trim()) {
        throw new Error(`Task ${index + 1} is missing non-empty \`${field}\`.`);
      }
    }
    const id = slugify(task.id);
    if (seen.has(id))
      throw new Error(`Duplicate task id after normalization: ${id}`);
    seen.add(id);
    if (task.dependsOn?.length) {
      throw new Error(
        "This MVP only accepts independent tasks; remove dependsOn or run sequentially.",
      );
    }
  }
  return plan;
}

function run(
  command,
  { cwd, env = {}, stdin = "", logFile, quiet = false, signal, onProcess } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Execution stopped."));
    const direct = typeof command === "object";
    const options = {
      cwd,
      env: { ...process.env, ...env },
      shell: !direct,
      stdio:
        direct && command.ipc
          ? ["pipe", "pipe", "pipe", "ipc"]
          : ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    };
    const child = direct
      ? spawn(command.file, command.args || [], options)
      : spawn(command, options);
    let stopTimer;

    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killTree = () => {
          const killer = spawn(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.on("error", () => child.kill());
          killer.on("close", (code) => {
            if (code !== 0) child.kill();
          });
        };
        if (child.connected) {
          child.send({ type: "stop" }, () => {});
          stopTimer = setTimeout(killTree, 2000);
        } else killTree();
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    };
    signal?.addEventListener("abort", stop, { once: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      stdout += value;
      if (!quiet) process.stdout.write(value);
    });
    child.stderr.on("data", (chunk) => {
      const value = chunk.toString();
      stderr += value;
      if (!quiet) process.stderr.write(value);
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      clearTimeout(stopTimer);
      signal?.removeEventListener("abort", stop);
      try {
        await onProcess?.(null);
        if (logFile) {
          await fs.mkdir(path.dirname(logFile), { recursive: true });
          await fs.writeFile(
            logFile,
            `# command\n${direct ? JSON.stringify(command) : command}\n\n# stdout\n${stdout}\n\n# stderr\n${stderr}\n`,
            "utf8",
          );
        }
        resolve({ code: code ?? 1, stdout, stderr });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on("error", () => {});
    Promise.resolve(onProcess?.(child.pid ?? null))
      .then(() => {
        if (stdin) child.stdin.write(stdin);
        child.stdin.end();
        if (signal?.aborted) stop();
      })
      .catch((error) => {
        stop();
        reject(error);
      });
  });
}

async function git(args, cwd, quiet = true) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  return result.stdout.trim();
}

async function resolveRepo(input) {
  const candidate = path.resolve(input || process.cwd());
  const root = await git(["rev-parse", "--show-toplevel"], candidate);
  return path.resolve(root);
}

function makeRunId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `run-${stamp}-${process.pid}`;
}

function workerPrompt(task) {
  return [
    "# Role",
    "You are a coding worker operating inside an isolated git worktree.",
    "",
    "# Task",
    task.prompt.trim(),
    "",
    "# Constraints",
    "- Work only on this task; avoid unrelated refactors.",
    "- Follow the repository instructions and use pstack rigor when available.",
    "- Verify the real behavior, not only compilation.",
    "- Do not create or remove git worktrees.",
    "- Do not merge branches.",
    "- Leave the worktree in a reviewable state.",
  ].join("\n");
}

function verifierPrompt(task) {
  return [
    "# Role",
    "You are an independent verifier. You did not author this change.",
    "",
    "# Task under verification",
    `${task.title}: ${task.prompt.trim()}`,
    "",
    "# Verification contract",
    "- Use pstack and the project verification skill when available.",
    "- Inspect the diff and reproduce the intended behavior independently.",
    "- Run the strongest relevant deterministic checks available.",
    "- Do not fix production code. If verification fails, report failure and evidence.",
    "- Prefer machine-readable evidence and concrete artifacts over claims.",
  ].join("\n");
}

async function captureGitState(worktree, evidenceDir, baseSha) {
  const [status, diffStat, diff] = await Promise.all([
    git(["status", "--short"], worktree).catch(
      (error) => `ERROR: ${error.message}`,
    ),
    git(["diff", "--stat", ...(baseSha ? [baseSha] : [])], worktree).catch(
      (error) => `ERROR: ${error.message}`,
    ),
    git(["diff", ...(baseSha ? [baseSha] : [])], worktree).catch(
      (error) => `ERROR: ${error.message}`,
    ),
  ]);
  await fs.writeFile(
    path.join(evidenceDir, "git-status.txt"),
    `${status}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(evidenceDir, "git-diff-stat.txt"),
    `${diffStat}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(evidenceDir, "git-diff.patch"),
    `${diff}\n`,
    "utf8",
  );
}

async function executeTask({
  task,
  repoRoot,
  baseSha,
  runId,
  runRoot,
  workerCommand,
  verifierCommand,
  checkCommand,
  dryRun,
  worktreesDir,
  requireReport,
  onPhase,
  signal,
  onProcess,
  quiet,
}) {
  const id = slugify(task.id);
  let branch = `codex/${runId}/${id}`;
  const worktreeRoot = path.join(
    worktreesDir ||
      path.join(path.dirname(repoRoot), ".code-harness-worktrees"),
    path.basename(repoRoot),
    runId,
  );
  const worktree = task.worktree
    ? path.resolve(task.worktree)
    : path.join(worktreeRoot, id);
  const evidenceDir = path.join(runRoot, "tasks", id);
  await fs.mkdir(evidenceDir, { recursive: true });

  const worker = workerPrompt(task);
  const reportName = `.code-harness-verification-${runId}.json`;
  const verifier =
    verifierPrompt(task) +
    (requireReport
      ? `\n\nWrite your verdict to ${reportName} in the worktree root. JSON schema: {"verdict":"passed|failed|blocked","summary":"concrete findings","checks":[{"name":"behavior checked","status":"passed|failed|blocked","evidence":"what you ran and observed"}]}. Include at least one check. All checks must pass for a passed verdict. If you could not run verification, use blocked. This report is the only file you may write. Do not change or commit the implementation.\n`
      : "");
  await fs.writeFile(
    path.join(evidenceDir, "worker-prompt.md"),
    worker,
    "utf8",
  );
  await fs.writeFile(
    path.join(evidenceDir, "verifier-prompt.md"),
    verifier,
    "utf8",
  );

  const result = {
    id,
    title: task.title,
    branch,
    worktree,
    status: "running",
    workerExitCode: null,
    verifierExitCode: null,
    checkExitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  if (dryRun) {
    result.status = "dry-run";
    result.finishedAt = new Date().toISOString();
    return result;
  }

  await fs.mkdir(worktreeRoot, { recursive: true });
  const exists = await fs
    .access(worktree)
    .then(() => true)
    .catch(() => false);
  if (task.worktree) {
    if (!exists)
      throw new Error(`Previous worktree no longer exists: ${worktree}`);
    const common = await git(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      worktree,
    );
    const expected = await git(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      repoRoot,
    );
    if (path.resolve(common) !== path.resolve(expected))
      throw new Error("Previous worktree belongs to a different repository.");
    branch = await git(["branch", "--show-current"], worktree);
    if (!branch.startsWith("codex/"))
      throw new Error("Refusing to reuse a non-harness branch.");
    if (task.branch && task.branch !== branch)
      throw new Error("Previous worktree is on a different task branch.");
    result.branch = branch;
    if (task.previousRunId && /^run-[a-zA-Z0-9-]+$/.test(task.previousRunId)) {
      const leftover = path.join(
        worktree,
        `.code-harness-verification-${task.previousRunId}.json`,
      );
      try {
        await fs.rename(
          leftover,
          path.join(evidenceDir, "interrupted-verification-report.json"),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  } else {
    if (exists) throw new Error(`Worktree path already exists: ${worktree}`);
    await git(
      ["worktree", "add", "-b", branch, worktree, baseSha],
      repoRoot,
      quiet,
    );
  }
  await onPhase?.({ phase: "running", ...result, evidenceDir });

  const commonEnv = {
    HARNESS_RUN_ID: runId,
    HARNESS_TASK_ID: id,
    HARNESS_TASK_TITLE: task.title,
    HARNESS_REPO_ROOT: repoRoot,
    HARNESS_WORKTREE: worktree,
    HARNESS_EVIDENCE_DIR: evidenceDir,
    HARNESS_WORKER_PROMPT_FILE: path.join(evidenceDir, "worker-prompt.md"),
    HARNESS_VERIFIER_PROMPT_FILE: path.join(evidenceDir, "verifier-prompt.md"),
  };

  const workerResult = await run(workerCommand, {
    cwd: worktree,
    env: commonEnv,
    stdin: worker,
    logFile: path.join(evidenceDir, "worker.log"),
    signal,
    onProcess,
    quiet,
  });
  result.workerExitCode = workerResult.code;

  if (workerResult.code !== 0) {
    result.status = "worker-failed";
    await captureGitState(worktree, evidenceDir, baseSha);
    result.finishedAt = new Date().toISOString();
    return result;
  }

  if (requireReport) {
    await git(["add", "--all"], worktree);
    if (await git(["diff", "--cached", "--name-only"], worktree)) {
      await git(
        [
          "-c",
          "user.name=Code Harness",
          "-c",
          "user.email=harness@localhost",
          "commit",
          "-m",
          `Task: ${task.title}`,
        ],
        worktree,
      );
    }
    result.headSha = await git(["rev-parse", "HEAD"], worktree);
  }
  await onPhase?.({ phase: "verifying", ...result, evidenceDir });

  if (verifierCommand) {
    const verifierResult = await run(verifierCommand, {
      cwd: worktree,
      env: commonEnv,
      stdin: verifier,
      logFile: path.join(evidenceDir, "verifier.log"),
      signal,
      onProcess,
      quiet,
    });
    result.verifierExitCode = verifierResult.code;
    if (verifierResult.code !== 0 && !requireReport) {
      result.status = "verification-failed";
      await captureGitState(worktree, evidenceDir, baseSha);
      result.finishedAt = new Date().toISOString();
      return result;
    }
    if (requireReport) {
      const reportPath = path.join(worktree, reportName);
      let report;
      try {
        report = JSON.parse(await fs.readFile(reportPath, "utf8"));
      } catch {
        report = {
          verdict: "blocked",
          summary: "The verifier did not produce a valid verification report.",
          checks: [],
        };
      }
      if (!report || typeof report !== "object" || Array.isArray(report))
        report = {
          verdict: "blocked",
          summary: "Invalid verification report.",
          checks: [],
        };
      await fs.rm(reportPath, { force: true });
      const clean = !(await git(["status", "--porcelain"], worktree));
      const sameHead =
        (await git(["rev-parse", "HEAD"], worktree)) === result.headSha;
      const validChecks =
        Array.isArray(report.checks) &&
        report.checks.length > 0 &&
        report.checks.every(
          (check) =>
            check &&
            typeof check.name === "string" &&
            check.name.trim() &&
            check.status === "passed" &&
            typeof check.evidence === "string" &&
            check.evidence.trim(),
        );
      if (!clean || !sameHead)
        report = {
          verdict: "blocked",
          summary:
            "The implementation changed during verification. Verify the new version before accepting it.",
          checks: report.checks ?? [],
        };
      else if (report.verdict === "passed" && !validChecks)
        report.verdict = "blocked";
      if (
        !["passed", "failed", "blocked"].includes(report.verdict) ||
        typeof report.summary !== "string" ||
        !report.summary.trim() ||
        !Array.isArray(report.checks) ||
        !report.checks.every(
          (check) =>
            check &&
            typeof check.name === "string" &&
            typeof check.evidence === "string" &&
            ["passed", "failed", "blocked"].includes(check.status),
        )
      )
        report = {
          verdict: "blocked",
          summary: "Invalid verification verdict.",
          checks: [],
        };
      if (verifierResult.code !== 0) report.verdict = "blocked";
      result.verification = { ...report, headSha: result.headSha };
      await fs.writeFile(
        path.join(evidenceDir, "verification-report.json"),
        JSON.stringify(result.verification, null, 2),
      );
      if (report.verdict !== "passed") {
        result.status =
          report.verdict === "failed"
            ? "verification-failed"
            : "verification-blocked";
        await captureGitState(worktree, evidenceDir, baseSha);
        result.finishedAt = new Date().toISOString();
        return result;
      }
    }
  }

  if (checkCommand) {
    const checkResult = await run(checkCommand, {
      cwd: worktree,
      env: commonEnv,
      logFile: path.join(evidenceDir, "check.log"),
      signal,
      onProcess,
      quiet,
    });
    result.checkExitCode = checkResult.code;
    if (checkResult.code !== 0) {
      result.status = "check-failed";
      await captureGitState(worktree, evidenceDir, baseSha);
      result.finishedAt = new Date().toISOString();
      return result;
    }
  }

  await captureGitState(worktree, evidenceDir, baseSha);
  if (requireReport) {
    await fs.writeFile(
      path.join(evidenceDir, "git-diff.patch"),
      await git(["diff", baseSha, "HEAD"], worktree),
    );
    await fs.writeFile(
      path.join(evidenceDir, "git-diff-stat.txt"),
      await git(["diff", "--stat", baseSha, "HEAD"], worktree),
    );
    if (
      (await git(["rev-parse", "HEAD"], worktree)) !== result.headSha ||
      (await git(["status", "--porcelain"], worktree))
    ) {
      result.status = "verification-blocked";
      result.error = "The implementation changed after verification.";
      result.finishedAt = new Date().toISOString();
      return result;
    }
  }
  result.status = "passed";
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
  --require-report              Require a structured report bound to the committed result
  --runs-dir <path>             Override the evidence storage root
  --worktrees-dir <path>         Override the isolated worktree storage root
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
  const gitVersion = await git(["--version"], repoRoot);
  const branch = await git(["branch", "--show-current"], repoRoot);
  const head = await git(["rev-parse", "HEAD"], repoRoot);
  console.log(
    JSON.stringify(
      {
        ok: true,
        repoRoot,
        nodeVersion,
        gitVersion,
        branch,
        head,
        platform: os.platform(),
      },
      null,
      2,
    ),
  );
}

export async function runPlan(options) {
  if (!options.plan) throw new Error("--plan is required.");
  if (!options["worker-command"] && !options["dry-run"])
    throw new Error("--worker-command is required unless --dry-run is used.");
  if (options["require-report"] && !options["verifier-command"])
    throw new Error(
      "A verifier command is required for a verification report.",
    );

  const repoRoot = await resolveRepo(options.repo);
  const planPath = path.resolve(options.plan);
  const plan = validatePlan(JSON.parse(await fs.readFile(planPath, "utf8")));
  const maxParallel = Number(options["max-parallel"] || 2);
  if (![1, 2].includes(maxParallel))
    throw new Error("--max-parallel must be 1 or 2 for the MVP.");

  const baseRef = plan.baseRef || "HEAD";
  const baseSha = await git(["rev-parse", baseRef], repoRoot);
  const runId = options.runId || makeRunId();
  const runRoot = path.join(
    options["runs-dir"] ||
      path.join(path.dirname(repoRoot), ".code-harness-runs"),
    path.basename(repoRoot),
    runId,
  );
  await fs.mkdir(runRoot, { recursive: true });
  await fs.copyFile(planPath, path.join(runRoot, "plan.json"));

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
  await fs.writeFile(
    path.join(runRoot, "run.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await options.onRunCreated?.({ ...manifest, runRoot });

  if (options["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          ...manifest,
          dryRun: true,
          plannedTasks: plan.tasks.map((task) => ({
            id: slugify(task.id),
            title: task.title,
          })),
        },
        null,
        2,
      ),
    );
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
      workerCommand: options["worker-command"],
      verifierCommand: options["verifier-command"] || "",
      checkCommand: options["check-command"] || "",
      dryRun: false,
      worktreesDir: options["worktrees-dir"],
      requireReport: Boolean(options["require-report"]),
      onPhase: options.onPhase,
      signal: options.signal,
      onProcess: options.onProcess,
      quiet: Boolean(options.quiet),
    })
      .then((result) => results.push(result))
      .catch((error) =>
        results.push({
          id: slugify(task.id),
          title: task.title,
          status: "orchestrator-failed",
          error: error.message,
        }),
      )
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
  manifest.status = manifest.tasks.every((task) => task.status === "passed")
    ? "passed"
    : "failed";
  await fs.writeFile(
    path.join(runRoot, "run.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  if (!options.quiet) {
    console.log(`\nRun evidence: ${runRoot}`);
    console.log(JSON.stringify(manifest, null, 2));
  }
  return { ...manifest, runRoot };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h")
    return printHelp();
  if (command === "doctor") return doctor(options);
  if (command === "run") {
    const manifest = await runPlan(options);
    if (manifest?.status !== "passed" && !options["dry-run"])
      process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[multi-agent-orchestrator] ${error.message}`);
    process.exitCode = 1;
  });
}
