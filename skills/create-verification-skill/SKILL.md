---
name: create-verification-skill
description: Create a project-local verification harness for coding agents.
---

# Create Verification Skill

Create a repeatable way for an agent to prove real user workflows.

## Required sections

A verification skill should define:

- Launch
- Doctor
- Drive
- Evidence
- Cleanup
- Feature Map

## Rules

Prefer existing project surfaces:

- browser automation
- CLI commands
- API boundaries
- existing test harnesses

Evidence should capture:

- the action performed
- the resulting state
- relevant artifacts

A screenshot alone is not enough when programmatic assertions are possible.
