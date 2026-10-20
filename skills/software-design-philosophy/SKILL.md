---
name: software-design-philosophy
description: Apply ideas from A Philosophy of Software Design to substantial implementation, module/API design, refactors and code reviews. Use for changes to public contracts, ownership, orchestration, lifecycle state, error handling or complicated control flow; not for trivial edits.
---

# Software Design Philosophy for Coding Agents

**Goal:** Minimize the complexity of the system that future developers must understand and modify, rather than minimizing code length, module size or a static metric. These are practical agent guidelines inspired by John Ousterhout's *A Philosophy of Software Design*, not quotations from the book.

## Scope and authority

- Read the consumer repository's `AGENTS.md`, relevant source, tests and contracts first. Respect the user's requested scope and existing quality gates.
- This is a **design lens**, not a replacement for implementation or verification workflows such as `pstack` or the project's own test/runtime verification skill.
- Scale the effort to the change. Small local fixes should be simple; consequential API or module decisions merit deliberate comparison.
- Do not change lint/quality thresholds, bypass checks, manufacture evidence, or expand a refactor merely to satisfy a design preference.

## Design principles

### 1. Strategic programming over tactical patches

- Solve the immediate requirement without creating hidden dependencies or costly follow-up cleanups.
- Avoid local patches that duplicate a lifecycle decision, spread a protocol detail, or entrench a confusing boundary.
- Make the smallest **coherent** change, not necessarily the fewest lines.

### 2. Deep modules with simple interfaces

- Prefer interfaces that express a useful, complete operation over sequences of small, caller-managed steps.
- Deepness is high functionality behind a simple interface, **not** a large source file or giant function.
- Judge cohesion, interface width, caller bookkeeping and change amplification; do not split a cohesive module solely to lower file-complexity or line-count metrics.

### 3. Hide information and prevent leakage

- Put ownership of invariants, protocol interpretation, lifecycle transitions, ordering and format decisions in one appropriate module.
- A decision that many callers must repeat or understand is leaking. Consolidate knowledge or give consumers an explicit stable contract.
- A representation being convenient to read does not make it authoritative for mutation or destructive transitions.

### 4. Separate abstractions, not just chronological steps

- Each layer should provide a distinct contract, policy, capability or ownership boundary.
- Challenge pass-through wrappers and generic `Manager`/`Service`/`Utils` types with no independent responsibility.
- Do not automatically create modules for `prepare`, `execute`, and `finish` when they all depend on the same internal state. Group by information ownership instead.

### 5. Pull complexity downward, without hiding failures

- Centralize defaults, validation, retries, edge cases and recovery in the module capable of handling them consistently.
- Where feasible, design APIs so invalid states or sequences cannot be expressed; otherwise codify invariants and failure behavior.
- Never silently swallow meaningful errors, business decisions, security checks or permission failures merely to simplify a caller.

### 6. Design away exceptional cases

- Look for a cleaner contract that handles ordinary and exceptional cases uniformly.
- Prefer removing unnecessary special states to adding repeated branching at every call site.
- Preserve explicit error semantics where exceptional outcomes remain significant.

### 7. Somewhat general-purpose, not speculative

- Choose simple mechanisms that cover demonstrated nearby needs; don't proliferate one-off special cases.
- Do not invent plugin systems, extension points, or abstraction layers for hypothetical future consumers.

### 8. Design it twice

For new public APIs, ownership boundaries or substantial refactors, compare at least two plausible designs. Evaluate:
- Caller complexity and API surface
- Information hiding and change amplification
- Cohesion, coupling and number of concepts
- Error semantics, state authority and verification cost

Choose the better system-level trade-off and explain it briefly. Skip formal comparisons for mechanical edits.

### 9. Prefer obvious, consistent code

- Use names that express the contract and avoid multiple terms for the same concept.
- Keep state ownership and dependencies explicit; avoid surprising side effects, temporal coupling and unclear booleans.
- Consolidate duplicated *knowledge*, not every repeated line. Do not trade legibility for fewer lines.

### 10. Comments document design knowledge, not code narration

- **Do not add comments by default** for obvious assignments, syntax, branches, loops or calls. Good names and structure should make these readable.
- **Do write or preserve comments** when code cannot communicate the essential contract: public API guarantees, invariants, ownership, concurrency ordering, external limitations, security constraints, non-obvious rationale and deliberate workarounds.
- For a consequential new public interface, first try writing a concise *contract comment* (what callers can rely on, including errors/lifecycle). If it is difficult to explain, reconsider the API.
- Delete or correct stale comments when changing behavior. Do not delete accurate contract/invariant comments under a “no comments” cleanup rule.
- A comment is not a substitute for clean structure, explicit contracts, documentation or tests.

Bad (narrates code):

```ts
// Check for timeout
if (elapsed > timeout) abort(); // Abort request
```

Better, only when this is a verified constraint:

```ts
// The gateway terminates SSE after 180 seconds. Fetch the final summary
// via a separate request; the original connection cannot deliver it.
if (elapsed > timeout) abort();
```

## Workflow for substantial changes

### 1. Understand

Inspect relevant callers and the owning source of truth. Identify the consumer, contract, mutable state owner, volatile implementation details, current behavior and the evidence needed to prove the change.

### 2. Compare

When API, module or lifecycle boundaries change, briefly compare two designs using the criteria above. Ask whether a proposed new helper hides knowledge or merely moves lines elsewhere.

### 3. Implement

- Preserve observable behavior unless a contract change was requested.
- Prefer intent-revealing operations and a cohesive module boundary.
- Review any new comments for information value; update stale ones.
- Avoid unrelated refactors and shallow forwarding abstractions.

### 4. Verify

- Run the existing checks relevant to the change; use the consumer repository's runtime verification workflow for behavior.
- Include negative, cancellation/race and lifecycle tests when those behaviors changed.
- Check for leaked decisions, duplicated transitions, increased caller burden and pass-through APIs.
- Treat `file-complexity` and similar metrics as signals, not proofs of poor design. **Obey existing blocking gates**; if a deep module genuinely conflicts with a threshold, explain the trade-off and request a human policy decision rather than gaming or disabling the rule.

## Review mode

Review actual changed code and related call paths. Report actionable findings with locations and a concrete change consequence. In particular ask:

1. Does the caller need to know orchestration or private representation?
2. Is one decision duplicated across multiple modules?
3. Does each new abstraction earn its existence?
4. Are lifecycle and state changes owned by an authoritative source?
5. Are special cases and temporal dependencies increasing?
6. Are comments narrating obvious code, or are contract/rationale comments missing or stale?

Do not report subjective style preferences as defects.

## Output for consequential work

Summarize the chosen boundary and alternative, knowledge hidden/removed, verified behavior, and any unresolved trade-off. Be concise; do not add a design report to trivial tasks.

Optional illustration: [next-console Agent lifecycle vs file-complexity](references/next-console-example.md). Only read it when relevant to orchestration or complexity-metric-driven splitting.
