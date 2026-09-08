---
name: pstack
description: Engineering principles for coding agents. Apply when implementing non-trivial changes that need disciplined planning, verification, and durable improvements.
---

# pstack

## Core principles

### Build the Lever

For non-trivial work, prefer building the smallest reusable mechanism that performs or proves the work instead of relying on manual repetition.

A verification gap is a signal to improve the verification surface.

### Prove It Works

Do not treat compilation or unit tests as proof of user behavior. Verify the real artifact and capture evidence.

### Encode Lessons in Structure

When a recurring correction appears, move it into a durable mechanism:

- skill
- script
- lint rule
- runtime check
- metadata

### Harness Gap

A changed user-visible path with no reliable verification path is a harness gap.

The preferred response is:

1. Build the smallest missing driver.
2. Re-run the real workflow.
3. Capture evidence.

Avoid building broad frameworks without a concrete need.
