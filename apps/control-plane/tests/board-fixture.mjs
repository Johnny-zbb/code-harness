import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTaskBoard, executeBoardTask } from "../server/task-board.mjs";

const exec = promisify(execFile);
export const git = async (repo, ...args) =>
  (await exec("git", args, { cwd: repo })).stdout.trim();

export async function boardFixture({
  mode = "passed",
  workerMode = "",
  execute,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harness-board-"));
  const repo = path.join(root, "sample-repo");
  const dataDir = path.join(root, "board");
  await fs.mkdir(repo);
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.name", "Harness Test");
  await git(repo, "config", "user.email", "test@localhost");
  await fs.writeFile(
    path.join(repo, "greeting.mjs"),
    'console.log("Hello world");\n',
  );
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  const initialHead = await git(repo, "rev-parse", "HEAD");
  const driver = path.join(root, "fixture-agent.mjs");
  await fs.writeFile(
    driver,
    `
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [role, mode] = process.argv.slice(2);
process.on('message', message => { if (message.type === 'stop') process.exit(130); });
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
if (role === 'worker') {
  if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 60000));
  const fallback = prompt.includes('朋友') ? '朋友' : 'world';
  await fs.writeFile('greeting.mjs', 'const name = process.argv.slice(2).join(" ").trim() || ' + JSON.stringify(fallback) + ';\\nconsole.log("Hello " + name);\\n');
  await fs.writeFile('received-feedback.txt', prompt);
  const event = JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'已修改问候命令，准备独立验证。'}}) + '\\n';
  await fs.writeFile(path.join(process.env.HARNESS_EVIDENCE_DIR, 'worker-events.jsonl'), event);
  console.log(event);
} else {
  const output = execFileSync(process.execPath, ['greeting.mjs', 'Ada'], {encoding:'utf8'}).trim();
  const fallback = execFileSync(process.execPath, ['greeting.mjs'], {encoding:'utf8'}).trim();
  const reportName = prompt.match(/\\.code-harness-verification-[a-zA-Z0-9-]+\\.json/)[0];
  const report = {verdict: mode === 'failed' ? 'failed' : 'passed', summary: mode === 'failed' ? '模拟验收发现缺陷，需要修改。' : '独立运行了姓名参数和默认值检查，结果符合验收条件。', checks:[{name:'姓名参数',status:mode === 'failed' ? 'failed' : 'passed',evidence:'node greeting.mjs Ada → ' + output},{name:'默认值',status:'passed',evidence:'node greeting.mjs → ' + fallback}]};
  if (mode !== 'missing') await fs.writeFile(reportName, mode === 'invalid' ? 'null' : JSON.stringify(report));
  if (mode === 'mutating') await fs.appendFile('greeting.mjs', '// verifier changed the code\\n');
  await fs.writeFile(path.join(process.env.HARNESS_EVIDENCE_DIR, 'verifier-events.jsonl'), JSON.stringify({type:'item.completed',item:{type:'agent_message',text:report.summary}}) + '\\n');
  console.log(report.summary);
}
if (process.connected) process.disconnect();
`,
  );
  const commands = {
    worker: {
      file: process.execPath,
      args: [driver, "worker", workerMode || "normal"],
      ipc: true,
    },
    verifier: {
      file: process.execPath,
      args: [driver, "verifier", mode],
      ipc: true,
    },
  };
  const run = (task, context) =>
    executeBoardTask(task, { ...context, commands });
  const options = {
    dataDir,
    defaultRepo: repo,
    execute: execute ? (task, context) => execute(task, context, run) : run,
  };
  const board = await createTaskBoard(options);
  return {
    root,
    repo,
    dataDir,
    initialHead,
    board,
    options,
    run,
    input: {
      repo,
      title: "为问候命令增加姓名参数",
      description: "问候命令支持传入姓名，保留默认问候。",
      acceptance: "传入 Ada 输出 Hello Ada；无参数输出 Hello world。",
    },
    async cleanup() {
      await board.close();
      const resolved = path.resolve(root);
      if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith("harness-board-")
      )
        throw new Error("Unsafe fixture cleanup path.");
      await fs.rm(resolved, { recursive: true, force: true });
    },
  };
}
