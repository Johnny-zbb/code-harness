---
name: multi-agent-orchestrator
description: Coordinate at most two independent coding agents in isolated git worktrees, then verify each result with pstack-style evidence.
---

# Multi-Agent Orchestrator

Use this skill only when a request benefits from parallel execution and can be split into **at most two independent work units**.

Default to one agent when one session can complete the work reliably. Multi-agent is useful when it buys real parallelism or independent verification, not merely because more agents are available.

## MVP workflow

1. Ground the request in the target repository.
2. Decide whether the work can be split into one or two independent tasks.
3. Write a plan JSON using the schema in `examples/plan.example.json`.
4. Run `orchestrate.mjs` with a worker command.
5. Prefer a separate verifier command so the verifier does not inherit the worker's assumptions.
6. Inspect `run.json`, worker/verifier logs, git status, and diff evidence before integrating anything.
7. Keep the worktrees for review. This MVP does not merge branches automatically.

## Routing rules

Use one task when:

- both changes touch the same core files or state boundary;
- task B needs task A's unmerged implementation;
- verification requires a shared singleton dev environment that cannot be isolated;
- coordination would cost more than sequential work.

Use two tasks only when:

- each task can start from the same base commit;
- each task can be verified independently;
- overlapping files are unlikely;
- each task has a crisp acceptance condition.

Do not encode dependencies in the plan. This MVP rejects `dependsOn` because dependent work requires integration semantics that are intentionally out of scope.

## Commands

```bash
node skills/multi-agent-orchestrator/orchestrate.mjs doctor --repo /path/to/repo
```

Dry-run a plan:

```bash
node skills/multi-agent-orchestrator/orchestrate.mjs run \
  --repo /path/to/repo \
  --plan ./plan.json \
  --dry-run
```

Run two workers and an independent verifier:

```bash
node skills/multi-agent-orchestrator/orchestrate.mjs run \
  --repo /path/to/repo \
  --plan ./plan.json \
  --worker-command "<coding-agent command>" \
  --verifier-command "<verification-agent command>" \
  --check-command "<deterministic project check>" \
  --max-parallel 2
```

The worker and verifier prompts are sent on stdin. The CLI also exposes prompt-file and evidence paths through environment variables so an adapter can ignore stdin if necessary.

## Evidence contract

Each task keeps:

- `worker-prompt.md`
- `verifier-prompt.md`
- `worker.log`
- `verifier.log` when configured
- `check.log` when configured
- `git-status.txt`
- `git-diff-stat.txt`
- `git-diff.patch`

The run root keeps `plan.json` and `run.json`.

Evidence is stored outside the target checkout under a sibling `.code-harness-runs/<repo>/<run-id>/` directory. Worktrees live under `.code-harness-worktrees/<repo>/<run-id>/`.

## Coordinator behavior

Before dispatching, restate the requirement in plain language and make the task boundaries explicit. A good task prompt should specify outcome and acceptance evidence without micromanaging implementation.

The coordinator must not invent parallelism. If the split is ambiguous, choose one worker.

## Integration boundary

This is the execution kernel for a future GrokBot / BoardUI front end. UI concerns such as agent cards, chat streams, approvals, and marketplace configuration stay outside this skill. The UI should consume the run/task state rather than own orchestration semantics.
