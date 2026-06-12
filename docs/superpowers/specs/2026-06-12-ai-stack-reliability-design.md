# ai-stack Reliability Design

## Goal

Resolve the verified CLI reliability, repository hygiene, packaging, documentation,
and test coverage findings without expanding the product scope.

## Architecture

Keep `src/cli.ts` as the executable entry point, but extract deterministic behavior
into `src/core.ts`. The core module owns setup-step construction and managed text
file merging. The CLI remains responsible for prompts, subprocess execution,
filesystem access, spinners, and process exit status.

This separation makes command contracts and file mutations testable with Node's
built-in test runner while preserving the existing runtime and dependency set.

## Behavior

- `ai-stack init -y` passes non-interactive flags to every supported setup tool,
  including `code-review-graph init -y`.
- Failure to detect or initialize a Git repository becomes a failed setup result.
- Managed `.gitignore` and `.gitattributes` entries use exact active-line matching,
  so comments and substrings do not suppress required entries.
- Managed block headers are emitted whenever a block adds at least one entry.
- Git hygiene ignores only disposable generated state. Agent instructions and
  shareable configuration remain eligible for source control.
- The unsupported `graphify-union` merge attribute is removed.

## Packaging And Documentation

- Require Node.js 20.17+, 22.13+, or 23.5+ to match the strictest runtime
  dependency.
- Add the MIT `LICENSE` included by the existing npm files allowlist.
- Document all four setup phases and the `--allow-warnings` option.
- Keep the tool installation table aligned with the command registry.

## Testing

Use `node:test` from `tests/` against compiled modules. Tests cover:

- exact-line managed block merging and idempotency;
- command construction in interactive and non-interactive modes;
- Git setup result semantics;
- package engine and license metadata;
- executable permissions for the compiled CLI.

The final gate is `npm test`, `npm run build`, `npm pack --dry-run --json`, CLI
help/version smoke checks, `graphify update .`, and a clean review of the
resulting diff.
