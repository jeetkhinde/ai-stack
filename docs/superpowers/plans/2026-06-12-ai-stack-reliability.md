# ai-stack Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all verified reliability, hygiene, packaging, documentation, and test coverage findings in the ai-stack CLI.

**Architecture:** Extract pure command and managed-file logic into `src/core.ts`, leaving terminal and subprocess orchestration in `src/cli.ts`. Build the application before executing `tests/core.test.mjs` with Node's built-in test runner.

**Tech Stack:** TypeScript, Node.js 20.17+, `node:test`, Commander, Execa, Ora.

---

### Task 1: Add Managed File Tests

**Files:**
- Create: `tests/core.test.mjs`
- Create: `src/core.ts`
- Modify: `package.json`

- [x] Write failing tests proving exact-line matching, block header insertion, and idempotency.
- [x] Run `npm test` and confirm failure because `src/core.js` does not exist.
- [x] Implement `mergeManagedBlock()` with normalized exact active-line matching.
- [x] Run `npm test` and confirm the managed-file tests pass.

### Task 2: Add Setup Command Tests

**Files:**
- Modify: `tests/core.test.mjs`
- Modify: `src/core.ts`
- Modify: `src/cli.ts`

- [x] Write failing tests for interactive and non-interactive setup command arrays.
- [x] Run `npm test` and confirm the missing core module fails compilation.
- [x] Move `buildSetupSteps()` to `src/core.ts` and pass `-y` to code-review-graph in automatic mode.
- [x] Run `npm test` and confirm command tests pass.

### Task 3: Propagate Git Setup Failure

**Files:**
- Modify: `tests/core.test.mjs`
- Modify: `src/core.ts`
- Modify: `src/cli.ts`

- [x] Write a failing test for converting Git setup status into a `StepResult`.
- [x] Run `npm test` and confirm the missing helper fails.
- [x] Return explicit detected, initialized, and failed Git outcomes and append the result to the CLI summary.
- [x] Run `npm test` and confirm Git result tests pass.

### Task 4: Correct Hygiene And Packaging

**Files:**
- Modify: `src/core.ts`
- Modify: `.gitignore`
- Modify: `.gitattributes`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `LICENSE`

- [x] Remove instruction files and shareable agent configuration from managed ignore entries.
- [x] Remove the unsupported graphify merge driver attribute.
- [x] Set the Node engine to the dependency-compatible ranges.
- [x] Add the MIT license text.
- [x] Add metadata and executable-mode tests and run `npm test`.

### Task 5: Align Documentation

**Files:**
- Modify: `README.md`

- [x] Document Phase C Git Hygiene and Phase D AI Integrations.
- [x] Document `--allow-warnings`, supported Node versions, generated-file policy, and corrected installation details.
- [x] Re-read the README against `ai-stack init --help`.

### Task 6: Verify The Release Surface

**Files:**
- Regenerate: `dist/*`
- Update: `graphify-out/*`

- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `node dist/cli.js --help`, `node dist/cli.js init --help`, and `node dist/cli.js --version`.
- [x] Run `npm_config_cache=/tmp/ai-stack-npm-cache npm pack --dry-run --json` and confirm `LICENSE` is included.
- [x] Run `graphify update .`.
- [x] Review `git diff --check`, `git diff`, and `git status --short`.
