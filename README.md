# ai-stack

CLI tool to bootstrap AI and development workflow tools for any new project. One command sets up your entire AI-assisted coding environment.

## What it does

`ai-stack init` runs a sequenced setup that:

1. **Detects & installs missing tools** — scans your PATH, offers to auto-install anything missing
2. **Phase A — Standard Tools** — configures codebase-memory-mcp, superpowers, caveman, code-review-graph, and echovault
3. **Phase B — Git Hooks** — ensures a git repo exists (auto-inits if needed), installs graphify hooks
4. **Phase C — AI Integrations** — registers graphify with Codex, Gemini, Antigravity, OpenCode, and Claude

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
# Interactive — prompts before installing missing tools
ai-stack init

# Non-interactive — auto-installs everything, great for CI/scripts
ai-stack init -y
```

## Prerequisites

These must already be on your PATH:

| Tool | Purpose |
|---|---|
| `git` | Version control |
| `npm` / `npx` | Node.js package management |

## Tools Managed

| Tool | Binary | Installed via |
|---|---|---|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | `codebase-memory-mcp` | `npm install -g` |
| [code-review-graph](https://github.com/tirth8205/code-review-graph) | `code-review-graph` | `uv` / `pipx` / `pip` |
| [graphify](https://github.com/safishamsi/graphify) | `graphify` | `uv` / `pipx` / `pip` |
| [echovault](https://github.com/mraza007/echovault) | `memory` | `uv` / `pipx` / `pip` |
| [superpowers](https://github.com/obra/superpowers) | via `npx` | `npx antigravity-superpowers init` |
| [caveman](https://github.com/JuliusBrussee/caveman) | via `npx` | `npx skills add` |

## Tech Stack

- **Runtime:** Node.js (≥18)
- **Language:** TypeScript
- **CLI Framework:** [commander](https://www.npmjs.com/package/commander)
- **Process Execution:** [execa](https://www.npmjs.com/package/execa)
- **Terminal Spinners:** [ora](https://www.npmjs.com/package/ora)
- **Colors:** [picocolors](https://www.npmjs.com/package/picocolors)
- **Prompts:** [@inquirer/prompts](https://www.npmjs.com/package/@inquirer/prompts)

## License

MIT
