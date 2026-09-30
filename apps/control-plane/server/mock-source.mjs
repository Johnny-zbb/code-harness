/**
 * Scripted demo run so the UI can be exercised before a real orchestrator run
 * exists. Each SSE connection starts a fresh timeline; cancel() stops it.
 */

export function createMockSource() {
  return {
    meta: { runId: 'run-20260929-001', mock: true },
    start(emit) {
      const timers = [];
      const at = (delayMs, event) => {
        timers.push(setTimeout(() => emit(event), delayMs));
      };

      const runId = 'run-20260929-001';
      const startedAt = new Date().toISOString();

      at(0, { type: 'run.started', runId, repo: 'next-console', branch: 'dev-preact', startedAt, requirement: '重构 next-console 的渲染层：拆组件、统一状态更新，并保持所有既有行为不变。' });

      at(600, { type: 'agent.message', taskId: null, agent: 'coordinator', text: '需求收到。我拆成两个独立任务：A 重构渲染层、B 补回归测试，各自在独立 worktree 里执行，互不依赖。' });

      at(1000, { type: 'task.started', taskId: 'task-a', title: '重构渲染层', attempt: 1 });
      at(1000, { type: 'agent.status', taskId: 'task-a', status: 'coding' });
      at(1300, { type: 'task.started', taskId: 'task-b', title: '补回归测试', attempt: 1 });
      at(1300, { type: 'agent.status', taskId: 'task-b', status: 'coding' });

      at(2500, { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: '开始重构 src/render/*，先拆组件再统一状态更新。' });
      at(3200, { type: 'agent.message', taskId: 'task-b', agent: 'worker', text: '先跑现有测试确认基线，再补 tests/render.spec.tsx。' });

      at(5000, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'log', path: 'tasks/task-a/worker.log' });
      at(5600, { type: 'evidence.created', taskId: 'task-b', evidenceType: 'log', path: 'tasks/task-b/worker.log' });

      at(7500, { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: '渲染层重构完成，typecheck 与 eslint 通过。' });
      at(8200, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'check', path: '', label: 'typecheck' });
      at(8700, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'check', path: '', label: 'eslint' });

      at(9500, { type: 'agent.message', taskId: 'task-b', agent: 'worker', text: '新增 6 个回归用例，其中 2 个暴露了旧实现的边界 bug。' });
      at(10500, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'git-diff', path: 'tasks/task-a/git-diff.patch' });
      at(11200, { type: 'evidence.created', taskId: 'task-b', evidenceType: 'git-diff', path: 'tasks/task-b/git-diff.patch' });

      // Task A: verifier rejects attempt 1, coordinator retries.
      at(12000, { type: 'agent.status', taskId: 'task-a', status: 'verifying' });
      at(12200, { type: 'agent.message', taskId: 'task-a', agent: 'verifier', text: '独立复现渲染行为，检查 diff 与验收条件。' });
      at(15000, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'screenshot', path: 'tasks/task-a/attempt-1.png', label: 'attempt-1.png' });
      at(17000, { type: 'agent.message', taskId: 'task-a', agent: 'verifier', text: '发现 hydration 时序与验收不符，判定不通过。' });
      at(18000, { type: 'agent.status', taskId: 'task-a', status: 'failed' });
      at(18500, { type: 'task.completed', taskId: 'task-a', status: 'failed' });
      at(19000, { type: 'agent.message', taskId: 'task-a', agent: 'coordinator', text: 'Verifier A 首轮未通过（hydration 时序）。让 Codex A 重试一次。' });

      // Task B: verifier starts while A retries.
      at(20000, { type: 'agent.status', taskId: 'task-b', status: 'verifying' });
      at(20200, { type: 'agent.message', taskId: 'task-b', agent: 'verifier', text: '复跑 6 个回归用例并检查覆盖率。' });

      at(22000, { type: 'task.started', taskId: 'task-a', title: '重构渲染层', attempt: 2 });
      at(22000, { type: 'agent.status', taskId: 'task-a', status: 'coding' });
      at(24000, { type: 'agent.message', taskId: 'task-a', agent: 'worker', text: '修复 hydration 时序，把副作用挂载移到 layout effect 之后。' });
      at(26500, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'git-diff', path: 'tasks/task-a/git-diff.patch', label: 'git-diff.patch (attempt 2)' });
      at(27500, { type: 'agent.status', taskId: 'task-a', status: 'verifying' });
      at(29000, { type: 'agent.message', taskId: 'task-a', agent: 'verifier', text: '重试验证通过——hydration 顺序正确，回归用例全绿。' });
      at(30000, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'check', path: '', label: 'verification' });
      at(30500, { type: 'evidence.created', taskId: 'task-a', evidenceType: 'screenshot', path: 'tasks/task-a/verification-passed.png', label: 'verification-passed.png' });
      at(31000, { type: 'task.completed', taskId: 'task-a', status: 'passed' });

      at(32000, { type: 'evidence.created', taskId: 'task-b', evidenceType: 'check', path: '', label: 'tests' });
      at(32500, { type: 'evidence.created', taskId: 'task-b', evidenceType: 'log', path: 'tasks/task-b/verifier.log' });
      at(33000, { type: 'task.completed', taskId: 'task-b', status: 'passed' });

      at(34500, { type: 'agent.message', taskId: null, agent: 'coordinator', text: '两个任务均通过验证。worktree 保留待 review，不自动合并。' });
      at(35500, { type: 'run.completed', runId, status: 'passed' });

      // Same contract as run-source: { ready, cancel }.
      return {
        ready: Promise.resolve(),
        cancel() {
          timers.forEach(clearTimeout);
        },
      };
    },
  };
}
