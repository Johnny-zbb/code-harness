import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runPlan } from "../../../skills/multi-agent-orchestrator/orchestrate.mjs";
import { mapCodexStream } from "./codex-events.mjs";

const exec = promisify(execFile);
const adapter = fileURLToPath(
  new URL(
    "../../../skills/multi-agent-orchestrator/adapters/codex.mjs",
    import.meta.url,
  ),
);
const copy = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const busyStates = new Set(["running", "verifying"]);
async function activity(task) {
  const directory = task.attempts.at(-1)?.evidenceDir;
  if (!directory || !busyStates.has(task.status)) return [];
  const role = task.status === "verifying" ? "verifier" : "worker";
  let file;
  try {
    file = await fs.open(path.join(directory, `${role}-events.jsonl`), "r");
    const { size } = await file.stat();
    const start = Math.max(0, size - 65536);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    return mapCodexStream(buffer.subarray(0, bytesRead).toString(), {
      role,
      taskId: task.id,
    })
      .filter((event) => event.type === "agent.message")
      .slice(-6)
      .map((event) => ({ role, text: event.text }));
  } catch {
    return [];
  } finally {
    await file?.close();
  }
}
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class BoardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function git(repo, args) {
  try {
    return (
      await exec("git", args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 })
    ).stdout.trim();
  } catch (error) {
    throw new BoardError(error.stderr?.trim() || error.message);
  }
}

function text(value, label, max = 20000) {
  if (typeof value !== "string" || !value.trim())
    throw new BoardError(`${label}不能为空。`);
  if (value.length > max) throw new BoardError(`${label}过长。`);
  return value.trim();
}

export async function executeBoardTask(
  task,
  { dataDir, onRunCreated, onPhase, signal, onProcess, commands },
) {
  const attempt = task.attempts.at(-1);
  const prompt = [
    task.description,
    "\n# Acceptance criteria",
    task.acceptance,
    "\n# Review conversation",
    ...task.messages
      .filter(
        (message) =>
          message.role === "user" &&
          message.text !== task.description &&
          message.text !== "验收通过，等待手动合入。",
      )
      .map((message) => message.text),
    "\n# Delivery",
    `Target repository branch: ${task.targetBranch}. Current target commit: ${task.baseSha}.`,
    "Continue in the existing worktree when provided. Preserve the previous implementation and address the review feedback.",
    "Later review feedback refines the initial acceptance criteria. Verify the latest requested changes together with all unchanged requirements.",
    "Write human-readable completion summaries and verification findings in Chinese; preserve literal commands, code, and output.",
    "If the target branch advanced, bring this task branch onto its current commit before delivery so it can be fast-forwarded.",
    "Do not push, merge into the target branch, deploy, or change other worktrees. Leave the result for human review.",
  ].join("\n");
  const plan = {
    name: task.title,
    requirement: task.description,
    baseRef: task.baseSha,
    tasks: [
      {
        id: task.id,
        title: task.title,
        prompt,
        ...(task.worktree
          ? {
              worktree: task.worktree,
              branch: task.branch,
              previousRunId: task.attempts.at(-2)?.runId,
            }
          : {}),
      },
    ],
  };
  const planDir = path.join(dataDir, "plans");
  await fs.mkdir(planDir, { recursive: true });
  const planPath = path.join(planDir, `${task.id}-${attempt.number}.json`);
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2));
  return runPlan({
    repo: task.repo,
    plan: planPath,
    runId: `run-${task.id}-${attempt.number}`,
    "worker-command": commands?.worker || {
      file: process.execPath,
      args: [adapter, "worker"],
      ipc: true,
    },
    "verifier-command": commands?.verifier || {
      file: process.execPath,
      args: [adapter, "verifier"],
      ipc: true,
    },
    "check-command": task.checkCommand,
    "max-parallel": 1,
    "require-report": true,
    "runs-dir": path.join(dataDir, "runs"),
    "worktrees-dir": path.join(dataDir, "worktrees"),
    onRunCreated,
    onPhase,
    signal,
    onProcess,
    quiet: true,
  });
}

/** One local queue, one worker at a time; review never holds up the next task. */
export async function createTaskBoard({
  dataDir,
  defaultRepo,
  execute = executeBoardTask,
}) {
  dataDir = path.resolve(dataDir);
  await fs.mkdir(dataDir, { recursive: true });
  const lockFile = path.join(dataDir, "server.lock");
  let lock;
  try {
    lock = await fs.open(lockFile, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = Number(await fs.readFile(lockFile, "utf8"));
    if (isAlive(owner))
      throw new Error("此任务看板已有服务在运行，不能重复启动自动队列。");
    await fs.unlink(lockFile);
    lock = await fs.open(lockFile, "wx");
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const storeFile = path.join(dataDir, "board.json");
  let state;
  try {
    state = JSON.parse(await fs.readFile(storeFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      await fs.unlink(lockFile);
      throw error;
    }
    state = { version: 1, tasks: [] };
  }
  if (state.version !== 1 || !Array.isArray(state.tasks)) {
    await fs.unlink(lockFile);
    await fs.unlink(lockFile);
    throw new Error("Invalid task board data.");
  }
  for (const task of state.tasks) {
    if (busyStates.has(task.status)) {
      task.status = "blocked";
      task.error =
        "服务重启，执行状态需要核对。原工作区保留；确认原 Agent 已停止后可发送修改意见继续。";
      task.messages.push({ role: "system", text: task.error, at: now() });
    }
  }
  let serial = Promise.resolve();
  let pumping = false;
  let closed = false;
  const controller = new AbortController();
  let idleResolve;
  let idle = Promise.resolve();

  async function persist() {
    const temporary = `${storeFile}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2));
    await fs.rename(temporary, storeFile);
  }
  function mutate(fn) {
    const operation = serial.then(async () => {
      const before = copy(state);
      try {
        const result = await fn();
        state.revision = (state.revision || 0) + 1;
        await persist();
        return copy(result);
      } catch (error) {
        state = before;
        throw error;
      }
    });
    serial = operation.catch(() => {});
    return operation;
  }
  function find(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) throw new BoardError("任务不存在。", 404);
    return task;
  }
  function schedule() {
    if (!closed)
      setImmediate(() =>
        pump().catch((error) => console.error("[task-board]", error.message)),
      );
  }

  async function pump() {
    if (pumping || closed) return;
    pumping = true;
    idle = new Promise((resolve) => {
      idleResolve = resolve;
    });
    try {
      while (!closed) {
        const task = await mutate(async () => {
          const next = state.tasks.find((item) => item.status === "queued");
          if (!next) return null;
          next.status = "running";
          delete next.headSha;
          delete next.approvedHead;
          next.error = null;
          next.updatedAt = now();
          next.attempts.push({
            number: next.attempts.length + 1,
            startedAt: now(),
            status: "running",
          });
          next.messages.push({
            role: "system",
            text: `Agent 已领取任务，开始第 ${next.attempts.length} 次开发。`,
            at: now(),
          });
          return next;
        });
        if (!task) break;
        try {
          const currentBase = await git(task.repo, [
            "rev-parse",
            `refs/heads/${task.targetBranch}`,
          ]);
          task.baseSha = currentBase;
          await mutate(() => {
            find(task.id).baseSha = currentBase;
          });
          const result = await execute(task, {
            dataDir,
            signal: controller.signal,
            onProcess: (pid) =>
              mutate(() => {
                find(task.id).executionPid = pid;
              }),
            onRunCreated: (run) =>
              mutate(() =>
                Object.assign(find(task.id).attempts.at(-1), {
                  runId: run.runId,
                  runRoot: run.runRoot,
                  baseSha: run.baseSha,
                }),
              ),
            onPhase: (phase) =>
              mutate(() => {
                const current = find(task.id);
                current.status = phase.phase;
                current.worktree = phase.worktree;
                current.branch = phase.branch;
                current.headSha = phase.headSha;
                Object.assign(current.attempts.at(-1), {
                  worktree: phase.worktree,
                  branch: phase.branch,
                  evidenceDir: phase.evidenceDir,
                });
                current.updatedAt = now();
              }),
          });
          await mutate(() => {
            const current = find(task.id);
            const outcome = result.tasks?.[0];
            if (!outcome) throw new Error("执行器没有返回任务结果。");
            Object.assign(current.attempts.at(-1), outcome, {
              runId: result.runId,
              runRoot: result.runRoot,
              finishedAt: now(),
            });
            current.branch = outcome.branch || current.branch;
            current.worktree = outcome.worktree || current.worktree;
            current.headSha = outcome.headSha;
            current.status =
              result.status === "passed" &&
              outcome.verification?.verdict === "passed"
                ? "review"
                : "blocked";
            current.error =
              current.status === "blocked"
                ? outcome.error ||
                  `执行未通过：${outcome.status}。查看报告后可提交修改意见。`
                : null;
            current.updatedAt = now();
            current.messages.push({
              role: "agent",
              text:
                outcome.verification?.summary ||
                current.error ||
                "开发与验证完成，请验收。",
              at: now(),
            });
          });
        } catch (error) {
          await mutate(() => {
            const current = find(task.id);
            current.status = "blocked";
            current.error = error.message;
            current.updatedAt = now();
            Object.assign(current.attempts.at(-1), {
              status: "orchestrator-failed",
              error: error.message,
              finishedAt: now(),
            });
            current.messages.push({
              role: "system",
              text: error.message,
              at: now(),
            });
          });
        }
      }
    } finally {
      pumping = false;
      idleResolve?.();
      if (state.tasks.some((task) => task.status === "queued")) schedule();
    }
  }

  async function ensureVerified(task) {
    const latest = task.attempts.at(-1);
    if (
      latest?.verification?.verdict !== "passed" ||
      latest.status !== "passed" ||
      !task.headSha
    )
      throw new BoardError("尚无通过的验证报告。", 409);
    if (
      (await git(task.worktree, ["rev-parse", "HEAD"])) !== task.headSha ||
      (await git(task.worktree, ["status", "--porcelain"]))
    )
      throw new BoardError("代码已变化，请重新开发和验证后再验收。", 409);
    if (
      (await git(task.repo, ["rev-parse", `refs/heads/${task.branch}`])) !==
      task.headSha
    )
      throw new BoardError("任务分支已变化，需要重新验证。", 409);
  }

  try {
    await persist();
  } catch (error) {
    await fs.unlink(lockFile);
    throw error;
  }
  schedule();
  return {
    dataDir,
    async snapshot() {
      await serial;
      const snapshot = copy({
        tasks: state.tasks,
        defaultRepo,
        runner: execute === executeBoardTask ? "codex" : "test-fixture",
        concurrency: 1,
        revision: state.revision || 0,
      });
      await Promise.all(
        snapshot.tasks.map(async (task) => {
          task.activity = await activity(task);
        }),
      );
      return snapshot;
    },
    async create(input) {
      const title = text(input.title, "任务标题", 200);
      const description = text(input.description, "任务要求");
      const acceptance = text(input.acceptance, "验收条件");
      const requestedRepo = text(input.repo || defaultRepo, "仓库路径", 4096);
      const checkCommand =
        typeof input.checkCommand === "string" ? input.checkCommand.trim() : "";
      if (checkCommand.length > 2000) throw new BoardError("验证命令过长。");
      const created = await mutate(async () => {
        const repo = path.resolve(
          await git(path.resolve(requestedRepo), [
            "rev-parse",
            "--show-toplevel",
          ]),
        );
        const targetBranch = await git(repo, ["branch", "--show-current"]);
        if (!targetBranch) throw new BoardError("目标仓库需要处于一个分支上。");
        const baseSha = await git(repo, ["rev-parse", "HEAD"]);
        const task = {
          id: randomUUID(),
          title,
          description,
          acceptance,
          repo,
          targetBranch,
          baseSha,
          checkCommand,
          status: "queued",
          createdAt: now(),
          updatedAt: now(),
          messages: [{ role: "user", text: description, at: now() }],
          attempts: [],
          error: null,
        };
        state.tasks.push(task);
        return task;
      });
      schedule();
      return created;
    },
    async rework(id, input) {
      const feedback = text(input.text, "修改意见");
      const task = await mutate(() => {
        const current = find(id);
        if (!["review", "blocked", "approved"].includes(current.status))
          throw new BoardError("请等本次执行结束后再提交修改意见。", 409);
        if (isAlive(current.executionPid))
          throw new BoardError(
            "原 Agent 进程仍在运行，请先等待它结束，避免同时修改同一工作区。",
            409,
          );
        current.messages.push({ role: "user", text: feedback, at: now() });
        current.status = "queued";
        delete current.headSha;
        delete current.approvedHead;
        current.error = null;
        current.updatedAt = now();
        return current;
      });
      schedule();
      return task;
    },
    async approve(id, input = {}) {
      return mutate(async () => {
        const task = find(id);
        if (task.status !== "review")
          throw new BoardError("仅待验收且验证通过的任务可以验收。", 409);
        if (input.headSha !== task.headSha)
          throw new BoardError("代码版本已变化，请刷新后验收当前版本。", 409);
        await ensureVerified(task);
        task.status = "approved";
        task.approvedHead = task.headSha;
        task.updatedAt = now();
        task.messages.push({
          role: "user",
          text: "验收通过，等待手动合入。",
          at: now(),
        });
        return task;
      });
    },
    async merge(id, input = {}) {
      return mutate(async () => {
        const task = find(id);
        if (task.status !== "approved" || task.approvedHead !== task.headSha)
          throw new BoardError("请先验收当前代码版本。", 409);
        if (input.headSha !== task.headSha)
          throw new BoardError("代码版本已变化，请刷新后确认合入。", 409);
        await ensureVerified(task);
        if (
          (await git(task.repo, ["branch", "--show-current"])) !==
          task.targetBranch
        )
          throw new BoardError(`请先切回目标分支 ${task.targetBranch}。`, 409);
        if (await git(task.repo, ["status", "--porcelain"]))
          throw new BoardError("目标仓库有未提交改动，请先处理后再合入。", 409);
        try {
          await git(task.repo, [
            "merge-base",
            "--is-ancestor",
            "HEAD",
            task.headSha,
          ]);
        } catch {
          throw new BoardError(
            "目标分支已经推进。请提交“同步最新目标分支并重新验证”的修改意见，再验收合入。",
            409,
          );
        }
        await git(task.repo, ["merge", "--ff-only", task.headSha]);
        task.status = "merged";
        task.mergedAt = now();
        task.updatedAt = now();
        task.messages.push({
          role: "system",
          text: `已合入 ${task.targetBranch}。`,
          at: now(),
        });
        return task;
      });
    },
    async artifact(id, attemptNumber, relative) {
      await serial;
      const task = find(id);
      const attempt = task.attempts.find(
        (item) => item.number === Number(attemptNumber),
      );
      if (!attempt?.evidenceDir) throw new BoardError("证据尚未生成。", 404);
      const root = await fs.realpath(attempt.evidenceDir).catch(() => null);
      if (!root) throw new BoardError("证据目录不存在。", 404);
      const candidate = path.resolve(root, relative);
      if (!candidate.startsWith(root + path.sep))
        throw new BoardError("证据路径无效。");
      const resolved = await fs.realpath(candidate).catch(() => null);
      if (!resolved || !resolved.startsWith(root + path.sep))
        throw new BoardError("证据文件不存在。", 404);
      return resolved;
    },
    async waitForIdle() {
      await new Promise((resolve) => setImmediate(resolve));
      await idle;
      await serial;
    },
    async close() {
      if (closed) return;
      closed = true;
      controller.abort();
      await idle;
      await serial;
      await fs.unlink(lockFile);
    },
  };
}
