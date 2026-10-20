# Optional AGENTS.md addition: Software design principles

> Copy the following section into a consuming project's existing `AGENTS.md`. Do not overwrite its existing rules. This file is an example, **not** an instruction to apply these rules to code-harness itself.

## Software Design Principles

For substantial implementation, module-boundary changes or refactors, consult the `software-design-philosophy` skill when available. For small changes, apply these principles without extra design ceremony.

- **Minimize system complexity, not code length.** Prefer changes that reduce cognitive burden, change amplification and hidden dependencies.
- **Prefer deep modules.** Give callers simple, stable operations hiding meaningful behavior. Do not split a cohesive module solely to satisfy file length or complexity scores.
- **Hide volatile decisions.** Keep protocols, invariants, lifecycle transitions and representation details with the appropriate owner. Do not spread ownership decisions to callers.
- **Every layer must earn its place.** Avoid pure forwarding wrappers, speculative abstractions, and generic helpers with no independent responsibility.
- **Push complexity to its rightful owner.** Encapsulate defaults, validation, retries and edge cases while preserving explicit security and error semantics.
- **For consequential API or ownership choices, design twice.** Compare at least two plausible boundaries and choose the lower system-level complexity.
- **Keep code comments sparse and meaningful.** Do not narrate obvious syntax or control flow. Explain public contracts, invariants, ownership, ordering, non-obvious rationale or external constraints when code alone cannot. Consider writing new public API contract comments before implementation. Update stale comments; preserve accurate ones.
- **Preserve behavior and follow quality gates.** Validate with project checks and observed behavior. Do not weaken mandatory gates or create meaningless file splits to optimize metrics. Surface genuine conflicts for an explicit decision.

For major changes, briefly report the design boundary, complexity impact and evidence of verification. Do not perform unrelated cleanup.
