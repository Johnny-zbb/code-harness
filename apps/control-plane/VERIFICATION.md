# Task board verification

Verified locally on 2026-10-01, Windows, Node 24.19.0, Codex CLI 0.159.2.

## Automated checks

- `npm run typecheck`: passed.
- `npm run build`: passed (React 19, installed BoardUI components, Tailwind 4).
- `npm test`: 28 passed. Includes real temporary Git worktrees, automatic FIFO execution, independent verification, invalid/failed/missing reports, verifier mutation, failed project checks, conversational rework, stale-version rejection, approval without integration, explicit fast-forward integration, restart recovery, exclusive queue ownership, active process cancellation, live agent messages, and HTTP/evidence guards.
- `node --test ../../skills/multi-agent-orchestrator/tests/*.test.mjs`: 6 passed.
- `git diff --check`: passed.

## Real Codex browser workflow

Started `node tests/board-preview.mjs --codex` against a newly created temporary Git repository, using the installed CLI and existing account. Submitted the task through the actual browser form; no API shortcut created the task or approved it.

The worker changed `greeting.mjs` to support a name argument. A separate Codex verifier independently executed the named greeting, default greeting, syntax check, diff/whitespace checks, and target-branch ancestry check. The structured report passed and was bound to commit `07432db774b92e305b25cb8aa0d8b4b66279df6d`.

After clicking **验收通过**, the target checkout still contained its original `Hello world` implementation and commit `68f26c73e4b26f667b87d762e57b1d832b6278d6`. Only after clicking **合入代码 → 确认合入** did the target checkout advance to the verified SHA. Independent terminal checks returned `Hello Ada`, `Hello world`, and a clean Git status. No remote push occurred.

The first CLI request encountered repeated timeouts before its HTTP fallback recovered. A transient Windows sandbox command error also recovered; the final independent checks ran successfully. This smoke test proves a small real task completes on this machine, not that every repository or task will succeed unattended.

The evidence and screenshots were retained locally under the ignored `.cache/control-plane-verification/` directory before removing temporary test repositories. The normal board at port 8787 contains no seeded test tasks.

## Browser rework and interface checks

Used `node tests/board-preview.mjs` with its explicitly labeled **测试执行器 · 临时仓库**. The fixture runs the same execution kernel and Git operations, replacing only the worker/verifier commands with deterministic drivers.

Submitted a task, inspected the report and diff, sent feedback to change the default greeting, and observed a second attempt in the original worktree. Both reports remained available. The first report disabled approval of the second version; the latest report showed `Hello 朋友`. Approval left the target unchanged, and the separate merge confirmation updated it. Terminal execution then returned `Hello 朋友` and `Hello Ada` with a clean status.

Checked desktop layout, the 820×1180 two-column tablet layout, and 390×844 mobile layout. Forms and reports remained usable without horizontal document overflow. Escape closed dialogs and restored focus. Light/dark themes rendered correctly. Dialog headings and footers stayed fixed while their body scrolled; the progressive top fade began transparent and appeared after scrolling. The normal board produced no browser console warnings or errors.

## Current scope

One local queue runs one task at a time, followed by a separate verifier. The service must stay running. Tasks start from committed code. Approval applies to an exact SHA, and integration supports only a clean, fast-forwardable local target branch. Advanced target branches require feedback, synchronization, and fresh verification. Remote hosting, parallel scheduling, multi-user access, and automatic push are not implemented.
