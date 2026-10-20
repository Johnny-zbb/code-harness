# Example: deep Agent run orchestration versus metric-driven splitting

*Illustrative TypeScript example only; not a claim about any repository's current implementation.*

An Agent run coordinates streaming events, cancellation, gateway timeouts, and session state transitions. The `AgentRunCoordinator` file triggers a file-complexity warning.

**Question:** Does splitting a complex file reduce *system* complexity or scatter lifecycle knowledge?

A metric-driven extraction can make the main file appear short while leaving the caller responsible for sequencing multiple pieces:

```ts
class AgentRunCoordinator {
  start(input: RunInput) {
    const ctx = prepareRun(input);
    const stream = createStream(ctx);
    attachStreamHandlers(stream, ctx);
    installTimeout(ctx);
  }
}
```

All extracted helpers may now know the same mutable `ctx`, cancellation rules and sequencing assumptions. This is not automatically a better design.

Explore a deeper caller-facing boundary:

```ts
interface AgentRun {
  start(input: RunInput): Promise<void>;
  abort(reason?: AbortReason): void;
}
```

Keep stream protocol, timeout handling, lifecycle ownership and state transitions behind the interface. Internal components are justified when they hide distinct knowledge, e.g. an `SseDecoder` for wire format or a `RunStateMachine` for authoritative state transitions.

**Neither an oversized module nor a passing metric proves quality.** If the existing file-complexity limit is 50, first seek meaningful submodule boundaries and behavior-preserving tests. If no coherent split is available, surface the design/quality-gate conflict; do not silently disable checks.

Review prompts:
- Can the caller perform a useful operation without knowing stream protocol or operation order?
- Is there one authoritative owner of abort, timeout and terminal state?
- Does an SSE protocol change affect only its decoder/adapter?
- Did the refactor decrease the number of concepts needed to reason about a change?
- Do tests cover cancellation, timeout, late events and state transitions?
