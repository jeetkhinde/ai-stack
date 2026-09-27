# ai-stack

CLI tool to bootstrap AI and development workflow tools for any new project. One command sets up your entire AI-assisted coding environment.

## What it does

`ai-stack init` runs a sequenced setup that:

1. **Detects & installs missing tools** — scans your PATH, offers to auto-install anything missing
2. **Interactive Selection** — select presets, specific agents, and which tools to enable (saves to `.ai-stackrc.json`)
3. **Phase A — Standard Tools** — configures code-review-graph and echovault
4. **Phase B — Git Hooks** — ensures a git repo exists, installs graphify hooks, and configures background memory reindexing
5. **Phase C — Git Hygiene** — ignores disposable local indexes, temp files, and marks generated graph output
6. **Phase D — AI Integrations** — registers graphify with your chosen agents (OpenCode is selected by default, supports 14+ others including Pi.dev, Hermes, Claude Code, Cursor, Aider, etc)

Agent instructions and shareable AI configuration are intentionally left
trackable so teams can keep project guidance in source control.

## Install

```bash
npm install -g ai-stack
```

Or clone and install locally:

```bash
git clone https://github.com/jeetkhinde/ai-stack.git
cd ai-stack
npm install
npm run build
npm install -g .
```

## Usage

```bash
# Interactive — prompts for presets, tools, and auto-installs missing binaries
ai-stack init

# Skip prompts and use defaults (or saved .ai-stackrc.json config)
ai-stack init -y

# Preview what would happen without making any changes
ai-stack init --dry-run

# Bypass interactive mode and explicitly set a preset or select agents
ai-stack init --preset standard
ai-stack init --agents opencode,cursor,pi,hermes

# Keep a zero exit status when optional setup steps emit warnings
ai-stack init --allow-warnings
```

`ai-stack init` automatically remembers your choices in a `.ai-stackrc.json` file so you don't have to keep selecting them. You can use `--reconfigure` to start over.

## Prerequisites

These must already be on your PATH:

| Tool | Purpose |
|---|---|
| Node.js 20.17+, 22.13+, or 23.5+ | CLI runtime |
| `git` | Version control |
| `npm` / `npx` | Node.js package management |

## Tools Managed

| Tool | Binary | Installed via |
|---|---|---|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | `codebase-memory-mcp` | `npm install -g` |
| [code-review-graph](https://github.com/tirth8205/code-review-graph) | `code-review-graph` | `uv` / `pipx` / `pip` |
| [graphify](https://github.com/safishamsi/graphify) | `graphify` | `graphifyy` via `uv` / `pipx` / `pip` |
| [echovault](https://github.com/mraza007/echovault) | `memory` | `uv` / `pipx` / `pip` |

## Tech Stack

- **Runtime:** Node.js 20.17+, 22.13+, or 23.5+
- **Language:** TypeScript
- **CLI Framework:** [commander](https://www.npmjs.com/package/commander)
- **Process Execution:** [execa](https://www.npmjs.com/package/execa)
- **Terminal Spinners:** [ora](https://www.npmjs.com/package/ora)
- **Colors:** [picocolors](https://www.npmjs.com/package/picocolors)
- **Prompts:** [@inquirer/prompts](https://www.npmjs.com/package/@inquirer/prompts)

## License

MIT
