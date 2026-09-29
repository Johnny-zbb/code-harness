# code-harness

Reusable engineering skills and verification workflows for coding agents.

## Install

```bash
npx skills add Johnny-zbb/code-harness
```

## Skills

### pstack

Engineering principles for coding agents.

Focus areas:

- Build the Lever
- Prove It Works
- Encode Lessons in Structure
- Sequence Work into Verifiable Units

### create-verification-skill

Create a project-local verification harness that can launch, drive, observe, and capture evidence for real user workflows.

### maintain-verification-skill

Maintain verification coverage as projects evolve. Detect stale feature maps, missing drivers, and harness gaps.

### multi-agent-orchestrator

MVP coordinator for running up to two independent coding agents in isolated git worktrees, followed by optional independent verification and deterministic checks.

A Codex CLI adapter is included so the common path is:

```bash
node skills/multi-agent-orchestrator/adapters/codex.mjs run \
  --repo /path/to/repo \
  --plan ./plan.json \
  --check-command "npm test"
```

The adapter preserves Codex JSONL events beside the normal pstack-style evidence, which makes the execution state consumable by the control-plane UI (`apps/control-plane`).

It intentionally stops before automatic branch integration. The first goal is to make parallel work observable and trustworthy before adding more autonomy.

### control-plane UI

A thin BoardUI-style console over the orchestrator. The UI owns no orchestration logic: it renders a unified `HarnessEvent` stream (SSE) that a zero-dependency local server adapts from `run.json`, `worker-events.jsonl`, and `verifier-events.jsonl`.

```bash
cd apps/control-plane
npm install
npm run dev       # scripted demo run + Vite dev server
npm run dev:server:live -- --runs-dir /path/to/.code-harness-runs   # real runs
```

## Philosophy

A coding agent should not only write code.

It should build the tools that prove the code works.
