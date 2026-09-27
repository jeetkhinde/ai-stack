# Interactive Init Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Make `ai-stack init` interactive with agent selection (presets + custom), tool selection, config persistence, dry-run, and verbose/quiet modes.

**Architecture:** Extract shared types to `types.ts`, add agent registry in `agents.ts`, config file logic in `config.ts`, and refactor `core.ts` + `cli.ts` to use selection-driven step building.

**Tech Stack:** TypeScript, commander, @inquirer/prompts (checkbox, select), picocolors, ora

---

### Task 1: Extract shared types to `src/types.ts`
### Task 2: Create agent registry in `src/agents.ts`
### Task 3: Create config file module `src/config.ts`
### Task 4: Refactor `core.ts` — selection-driven `buildSetupSteps()`
### Task 5: Add tool selection support
### Task 6: Rewrite `cli.ts` interactive flow
### Task 7: Update tests
### Task 8: Update documentation
### Task 9: Bump version and final verification
