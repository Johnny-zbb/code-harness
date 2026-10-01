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

The execution kernel keeps task branches separate. The control-plane board adds persistent queuing, version-bound verification reports, conversational rework, and explicitly confirmed local integration.

### control-plane UI

A React 19 + Tailwind CSS 4 task board using installed BoardUI components. Add a todo and Codex develops automatically in an isolated worktree, then independently verifies it. Review the report, send feedback to continue the same task, or approve and explicitly merge the verified version. The local Node service persists tasks and review history. It runs one task at a time and never pushes or merges without your decision.

```bash
cd apps/control-plane
npm install
codex login       # once, if needed
npm run dev       # automatic Codex task board + Vite dev server
npm run build
npm start         # built UI and API on http://127.0.0.1:8787
```

See [the task board README](apps/control-plane/README.md) for the workflow, API, and reproducible temporary-repository browser driver. The earlier event viewer remains available as a separate demo workspace.

## Philosophy

A coding agent should not only write code.

It should build the tools that prove the code works.
