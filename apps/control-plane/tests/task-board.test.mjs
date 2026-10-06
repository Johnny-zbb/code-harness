import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { boardFixture, git } from "./board-fixture.mjs";
import { createTaskBoard } from "../server/task-board.mjs";
import { createControlPlane } from "../server/server.mjs";

async function completed(board, input) {
  const task = await board.create(input);
  await board.waitForIdle();
  return (await board.snapshot()).tasks.find((item) => item.id === task.id);
}

test("queued task develops and verifies automatically, then waits for separate approval and merge", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  const { board, repo, initialHead } = fixture;
  const queued = await board.create(fixture.input);
  assert.equal(queued.status, "queued");
  await board.waitForIdle();
  const task = (await board.snapshot()).tasks[0];
  assert.equal(task.status, "review");
  assert.equal(task.attempts[0].verification.verdict, "passed");
  assert.equal(task.attempts[0].verification.headSha, task.headSha);
  assert.notEqual(task.headSha, initialHead);
  assert.equal(
    await git(repo, "rev-parse", "HEAD"),
    initialHead,
    "verification must not merge",
  );
  assert.equal(
    await fs.readFile(path.join(repo, "greeting.mjs"), "utf8"),
    'console.log("Hello world");\n',
  );
  const diff = await fs.readFile(
    await board.artifact(task.id, 1, "git-diff.patch"),
    "utf8",
  );
  assert.match(diff, /process\.argv/);
  await assert.rejects(
    () => board.merge(task.id, { headSha: task.headSha }),
    /先验收/,
  );
  assert.equal(
    (await board.approve(task.id, { headSha: task.headSha })).status,
    "approved",
  );
  assert.equal(
    await git(repo, "rev-parse", "HEAD"),
    initialHead,
    "approval alone must not merge",
  );
  assert.equal(
    (await board.merge(task.id, { headSha: task.headSha })).status,
    "merged",
  );
  assert.equal(await git(repo, "rev-parse", "HEAD"), task.headSha);
  await board.close();
  const reopened = await createTaskBoard(fixture.options);
  t.after(() => reopened.close());
  assert.equal((await reopened.snapshot()).tasks[0].status, "merged");
  await reopened.close();
});

test("review feedback reuses the task worktree, retains history, and produces a new verified version", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  const first = await completed(fixture.board, fixture.input);
  await fixture.board.rework(first.id, { text: "无参数的问候对象改成朋友。" });
  await fixture.board.waitForIdle();
  const task = (await fixture.board.snapshot()).tasks[0];
  assert.equal(task.status, "review");
  assert.equal(task.attempts.length, 2);
  assert.equal(task.worktree, first.worktree);
  assert.equal(task.branch, first.branch);
  assert.notEqual(task.headSha, first.headSha);
  assert.equal(task.attempts[0].verification.headSha, first.headSha);
  assert.match(
    await fs.readFile(
      path.join(task.worktree, "received-feedback.txt"),
      "utf8",
    ),
    /无参数的问候对象改成朋友/,
  );
  assert.match(
    await fs.readFile(path.join(task.worktree, "greeting.mjs"), "utf8"),
    /朋友/,
  );
  await assert.rejects(
    () => fixture.board.approve(task.id, { headSha: first.headSha }),
    /版本已变化/,
  );
  await fixture.board.approve(task.id, { headSha: task.headSha });
  assert.equal(
    await git(fixture.repo, "rev-parse", "HEAD"),
    fixture.initialHead,
  );
});

for (const mode of ["failed", "missing", "invalid", "mutating"]) {
  test(`verifier exiting zero with ${mode} evidence never becomes an accepted task`, async (t) => {
    const fixture = await boardFixture({ mode });
    t.after(() => fixture.cleanup());
    const task = await completed(fixture.board, fixture.input);
    assert.equal(task.status, "blocked");
    assert.equal(task.attempts[0].verifierExitCode, 0);
    assert.notEqual(task.attempts[0].verification?.verdict, "passed");
    await assert.rejects(
      () => fixture.board.approve(task.id, { headSha: task.headSha }),
      /待验收/,
    );
    assert.equal(
      await git(fixture.repo, "rev-parse", "HEAD"),
      fixture.initialHead,
    );
  });
}

test("failed deterministic checks block approval even when the verifier says passed", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  const task = await completed(fixture.board, {
    ...fixture.input,
    checkCommand: `"${process.execPath}" -e "process.exit(1)"`,
  });
  assert.equal(task.status, "blocked");
  assert.equal(task.attempts[0].status, "check-failed");
  assert.equal(task.attempts[0].checkExitCode, 1);
  await assert.rejects(
    () => fixture.board.approve(task.id, { headSha: task.headSha }),
    /待验收/,
  );
});

test("changed verified code, dirty target checkout, and advanced target branch prevent merge", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  const { board, repo } = fixture;
  const task = await completed(board, fixture.input);
  await fs.writeFile(
    path.join(task.worktree, "after-verification.txt"),
    "unverified",
  );
  await assert.rejects(
    () => board.approve(task.id, { headSha: task.headSha }),
    /代码已变化/,
  );
  await fs.unlink(path.join(task.worktree, "after-verification.txt"));
  await board.approve(task.id, { headSha: task.headSha });
  await fs.writeFile(
    path.join(repo, "local-work.txt"),
    "keep my local changes",
  );
  await assert.rejects(
    () => board.merge(task.id, { headSha: task.headSha }),
    /未提交改动/,
  );
  assert.equal(
    await fs.readFile(path.join(repo, "local-work.txt"), "utf8"),
    "keep my local changes",
  );
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "target advanced");
  const advanced = await git(repo, "rev-parse", "HEAD");
  await assert.rejects(
    () => board.merge(task.id, { headSha: task.headSha }),
    /目标分支已经推进/,
  );
  assert.equal(await git(repo, "rev-parse", "HEAD"), advanced);
});

test("automatic queue is FIFO and never has two workers writing at the same time", async (t) => {
  let active = 0;
  let maximum = 0;
  const order = [];
  const fixture = await boardFixture({
    execute: async (task, context, run) => {
      active += 1;
      maximum = Math.max(maximum, active);
      order.push(task.title);
      try {
        return await run(task, context);
      } finally {
        active -= 1;
      }
    },
  });
  t.after(() => fixture.cleanup());
  const [first, second] = await Promise.all([
    fixture.board.create({ ...fixture.input, title: "first" }),
    fixture.board.create({ ...fixture.input, title: "second" }),
  ]);
  await fixture.board.waitForIdle();
  assert.equal(maximum, 1);
  assert.deepEqual(order, ["first", "second"]);
  assert.equal((await fixture.board.snapshot()).tasks.length, 2);
  assert.ok(first.id !== second.id);
});

test("interrupted work is preserved and requires an explicit continuation after restart", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  const task = await completed(fixture.board, fixture.input);
  await fixture.board.close();
  const file = path.join(fixture.dataDir, "board.json");
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  stored.tasks[0].status = "verifying";
  await fs.writeFile(
    path.join(
      task.worktree,
      `.code-harness-verification-${task.attempts[0].runId}.json`,
    ),
    '{"verdict":"passed"}',
  );
  await fs.writeFile(file, JSON.stringify(stored));
  let calls = 0;
  const board = await createTaskBoard({
    ...fixture.options,
    execute: async (...args) => {
      calls += 1;
      return fixture.options.execute(...args);
    },
  });
  t.after(() => board.close());
  await board.waitForIdle();
  assert.equal(calls, 0);
  assert.equal((await board.snapshot()).tasks[0].status, "blocked");
  assert.equal((await board.snapshot()).tasks[0].worktree, task.worktree);
  await board.rework(task.id, { text: "继续完成验证。" });
  await board.waitForIdle();
  assert.equal(calls, 1);
  assert.equal((await board.snapshot()).tasks[0].status, "review");
  assert.equal(
    await git(task.worktree, "ls-files", ".code-harness-verification-*.json"),
    "",
  );
  await board.close();
});

test("board HTTP actions reject foreign origins, form posts, and evidence traversal", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  const { server } = await createControlPlane({ board: fixture.board });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, body, headers = {}) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await request("/api/board/tasks", fixture.input, {
        Origin: "https://outside.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/board/tasks", fixture.input, {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  const initial = await fetch(base + "/api/board");
  assert.equal(initial.headers.get("access-control-allow-origin"), null);
  assert.equal((await initial.json()).tasks.length, 0);
  const response = await request("/api/board/tasks", fixture.input);
  assert.equal(response.status, 201);
  const created = await response.json();
  await fixture.board.waitForIdle();
  const task = (await fixture.board.snapshot()).tasks[0];
  const file = `${base}/api/board/tasks/${created.id}/attempts/1/file?path=`;
  assert.equal(
    (await fetch(file + encodeURIComponent("../../board.json"))).status,
    400,
  );
  assert.equal((await fetch(file + "missing.txt")).status, 404);
  assert.match(await (await fetch(file + "git-diff.patch")).text(), /greeting/);
  const outside = path.join(fixture.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "private.txt"), "not an artifact");
  await fs.symlink(
    outside,
    path.join(task.attempts[0].evidenceDir, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (await fetch(file + encodeURIComponent("escape/private.txt"))).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/board/tasks/${created.id}/approve`, {
        headSha: "stale",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/board/tasks/${created.id}/approve`, {
        headSha: task.headSha,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/api/board/tasks/${created.id}/merge`, {
        headSha: task.headSha,
      })
    ).status,
    200,
  );
});

test("only one service may own an automatic board queue", async (t) => {
  const fixture = await boardFixture();
  t.after(() => fixture.cleanup());
  await assert.rejects(() => createTaskBoard(fixture.options), /已有服务/);
});

test(
  "closing the service terminates the active worker without touching the target branch",
  { timeout: 15000 },
  async (t) => {
    const fixture = await boardFixture({ workerMode: "slow" });
    t.after(() => fixture.cleanup());
    await fixture.board.create(fixture.input);
    let task;
    for (let index = 0; index < 100; index += 1) {
      task = (await fixture.board.snapshot()).tasks[0];
      if (task.executionPid) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(task.executionPid, "worker must actually start before shutdown");
    await fs.writeFile(
      path.join(task.attempts[0].evidenceDir, "worker-events.jsonl"),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "正在修改问候命令，保留无参数行为。",
        },
      }) + "\n",
    );
    assert.equal(
      (await fixture.board.snapshot()).tasks[0].activity.at(-1).text,
      "正在修改问候命令，保留无参数行为。",
    );
    await fixture.board.close();
    assert.throws(
      () => process.kill(task.executionPid, 0),
      "worker must no longer be alive",
    );
    assert.equal((await fixture.board.snapshot()).tasks[0].status, "blocked");
    assert.equal(
      await git(fixture.repo, "rev-parse", "HEAD"),
      fixture.initialHead,
    );
    assert.equal(
      await fs.readFile(path.join(fixture.repo, "greeting.mjs"), "utf8"),
      'console.log("Hello world");\n',
    );
  },
);
