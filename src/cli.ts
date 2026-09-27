#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { execa } from "execa";
import ora, { type Ora } from "ora";
import pc from "picocolors";
import { confirm, select, checkbox } from "@inquirer/prompts";
import {
  buildSetupPlan,
  GITATTRIBUTES_GROUPS,
  GITIGNORE_GROUPS,
  gitRepoStepResult,
  MANAGED_BLOCK_HEADER,
  mergeManagedBlock,
  shouldSetFailureExitCode,
  TOOL_REGISTRY,
  defaultToolIds,
  type SetupPlan,
  type StepDefinition,
  type StepResult,
} from "./core.js";
import {
  AGENT_REGISTRY,
  PRESETS,
  DEFAULT_AGENT_ID,
  resolveAgents,
  allAgentIds,
  findPreset,
  type AgentDefinition,
  type PresetName,
} from "./agents.js";
import {
  loadConfig,
  saveConfig,
  buildConfig,
  configPath,
  type AiStackConfig,
} from "./config.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const VERSION = "1.1.0";

// ─── Types ───────────────────────────────────────────────────────────────────

type PythonPM = "uv" | "pipx" | "pip";

interface ToolInstaller {
  /** Human-readable name shown to the user. */
  displayName: string;
  /** The binary name to look for on PATH. */
  binary: string;
  /**
   * The package name used for installation.
   * May differ from displayName (e.g. graphify installs from PyPI package "graphifyy").
   */
  packageName: string;
  /** Whether the tool supports project-local installation. */
  supportsLocal: boolean;
  /** Build install command for global scope. `pythonPM` is set when available. */
  installGlobal: (pythonPM: PythonPM | null) => StepDefinition | null;
  /** Build install command for project-local scope (if supported). */
  installLocal?: () => StepDefinition;
}

interface PreflightResult {
  /** Tools that were already on PATH. */
  found: string[];
  /** Tools that remain missing after any install attempt. */
  stillMissing: string[];
  /** Whether auto-install was attempted. */
  installAttempted: boolean;
}

interface InitOptions {
  yes?: boolean;
  allowWarnings?: boolean;
  dryRun?: boolean;
  preset?: string;
  agents?: string;
  tools?: string;
  reconfigure?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

// ─── Installable Tool Registry ───────────────────────────────────────────────
// Single source of truth: displayName, binary, packageName, and install logic.
// Note: graphify's PyPI package is "graphifyy" (double-y) to avoid a name conflict.

const INSTALLABLE_TOOLS: ToolInstaller[] = [
  {
    displayName: "codebase-memory-mcp",
    binary: "codebase-memory-mcp",
    packageName: "codebase-memory-mcp",
    supportsLocal: false,
    installGlobal: () => ({
      label: "Installing codebase-memory-mcp (npm)",
      command: "npm",
      args: ["install", "-g", "codebase-memory-mcp"],
    }),
  },
  {
    displayName: "code-review-graph",
    binary: "code-review-graph",
    packageName: "code-review-graph",
    supportsLocal: false,
    installGlobal: (pm) => {
      if (!pm) return null;
      const cmds: Record<PythonPM, StepDefinition> = {
        uv:   { label: "Installing code-review-graph (uv)",   command: "uv",   args: ["tool", "install", "code-review-graph"] },
        pipx: { label: "Installing code-review-graph (pipx)", command: "pipx", args: ["install", "code-review-graph"] },
        pip:  { label: "Installing code-review-graph (pip)",  command: "pip",  args: ["install", "code-review-graph"] },
      };
      return cmds[pm];
    },
  },
  {
    displayName: "graphify",
    binary: "graphify",
    packageName: "graphifyy",  // PyPI package name differs from binary name
    supportsLocal: false,
    installGlobal: (pm) => {
      if (!pm) return null;
      const cmds: Record<PythonPM, StepDefinition> = {
        uv:   { label: "Installing graphify (uv) — pkg: graphifyy",   command: "uv",   args: ["tool", "install", "graphifyy"] },
        pipx: { label: "Installing graphify (pipx) — pkg: graphifyy", command: "pipx", args: ["install", "graphifyy"] },
        pip:  { label: "Installing graphify (pip) — pkg: graphifyy",  command: "pip",  args: ["install", "graphifyy"] },
      };
      return cmds[pm];
    },
  },
  {
    displayName: "echovault (memory)",
    binary: "memory",          // CLI binary name differs from package name
    packageName: "echovault",
    supportsLocal: false,
    installGlobal: (pm) => {
      if (!pm) return null;
      const cmds: Record<PythonPM, StepDefinition> = {
        uv:   { label: "Installing echovault (uv)",   command: "uv",   args: ["tool", "install", "echovault"] },
        pipx: { label: "Installing echovault (pipx)", command: "pipx", args: ["install", "echovault"] },
        pip:  { label: "Installing echovault (pip)",  command: "pip",  args: ["install", "echovault"] },
      };
      return cmds[pm];
    },
  },
];

/** Tools that are required as a prerequisite (not installable by us). */
const PREREQUISITE_BINARIES = ["git", "npm", "npx"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether a binary exists on the user's PATH.
 */
async function binaryExists(name: string): Promise<boolean> {
  try {
    await execa("command", ["-v", name], { shell: true });
    return true;
  } catch {
    try {
      await execa("which", [name]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Detect the best available Python package manager.
 * Preference order: uv > pipx > pip
 */
async function detectPythonPM(): Promise<PythonPM | null> {
  for (const pm of ["uv", "pipx", "pip"] as const) {
    if (await binaryExists(pm)) return pm;
  }
  return null;
}

/**
 * Ensure the current working directory is inside a git repository.
 * If not, run `git init` to create one.
 */
async function ensureGitRepo(dryRun: boolean): Promise<StepResult> {
  if (dryRun) {
    console.log(`  ${pc.dim("○")} Would check/init git repository`);
    return { label: "Git repository", success: true };
  }

  const spinner = ora({ text: "Checking for git repository…", color: "blue" }).start();

  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    spinner.succeed(pc.green("Git repository detected"));
    return gitRepoStepResult("detected");
  } catch {
    spinner.text = "No git repo found — running git init…";
    try {
      await execa("git", ["init"], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      spinner.succeed(pc.green("Initialised new git repository"));
      return gitRepoStepResult("initialized");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      spinner.warn(pc.yellow(`Failed to initialise git repo — ${pc.dim(message)}`));
      return gitRepoStepResult("failed", message);
    }
  }
}

/**
 * Run a single setup step with a terminal spinner.
 * On failure the error is captured and the spinner shows a warning.
 */
async function runStep(step: StepDefinition, verbose: boolean): Promise<StepResult> {
  const spinner: Ora = ora({ text: step.label, color: "cyan" }).start();

  try {
    const result = await execa(step.command, step.args, {
      cwd: process.cwd(),
      stdout: verbose ? "inherit" : "pipe",
      stderr: verbose ? "inherit" : "pipe",
    });

    if (verbose && result.stdout) {
      console.log(pc.dim(result.stdout));
    }

    spinner.succeed(pc.green(step.label));
    return { label: step.label, success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    spinner.warn(pc.yellow(`${step.label} — ${pc.dim(message)}`));
    return { label: step.label, success: false, error: message };
  }
}

/**
 * Print a dry-run line for a step (no execution).
 */
function dryRunStep(step: StepDefinition): StepResult {
  console.log(`  ${pc.dim("○")} Would run: ${pc.cyan(`${step.command} ${step.args.join(" ")}`)}`);
  return { label: step.label, success: true };
}

// ─── Git Hygiene Functions ───────────────────────────────────────────────────

/**
 * Ensure .gitignore contains all required entries.
 * Appends missing entries idempotently — never duplicates, never removes user entries.
 */
function ensureGitignore(dryRun: boolean): StepResult {
  if (dryRun) {
    console.log(`  ${pc.dim("○")} Would update .gitignore`);
    return { label: ".gitignore", success: true };
  }

  const filePath = join(process.cwd(), ".gitignore");
  const spinner = ora({ text: "Configuring .gitignore", color: "cyan" }).start();

  try {
    const content = existsSync(filePath)
      ? readFileSync(filePath, "utf-8")
      : "";

    const merged = mergeManagedBlock(
      content,
      MANAGED_BLOCK_HEADER,
      GITIGNORE_GROUPS
    );

    if (!merged.changed) {
      spinner.succeed(pc.green(".gitignore — already up to date"));
      return { label: ".gitignore", success: true };
    }

    writeFileSync(filePath, merged.content, "utf-8");

    spinner.succeed(
      pc.green(`.gitignore — added ${merged.addedEntries} entries`)
    );
    return { label: ".gitignore", success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    spinner.warn(pc.yellow(`.gitignore — ${pc.dim(message)}`));
    return { label: ".gitignore", success: false, error: message };
  }
}

/**
 * Ensure .gitattributes contains all required entries.
 * Appends missing entries idempotently.
 */
function ensureGitattributes(dryRun: boolean): StepResult {
  if (dryRun) {
    console.log(`  ${pc.dim("○")} Would update .gitattributes`);
    return { label: ".gitattributes", success: true };
  }

  const filePath = join(process.cwd(), ".gitattributes");
  const spinner = ora({ text: "Configuring .gitattributes", color: "cyan" }).start();

  try {
    const content = existsSync(filePath)
      ? readFileSync(filePath, "utf-8")
      : "";

    const merged = mergeManagedBlock(
      content,
      MANAGED_BLOCK_HEADER,
      GITATTRIBUTES_GROUPS
    );

    if (!merged.changed) {
      spinner.succeed(pc.green(".gitattributes — already up to date"));
      return { label: ".gitattributes", success: true };
    }

    writeFileSync(filePath, merged.content, "utf-8");

    spinner.succeed(
      pc.green(`.gitattributes — added ${merged.addedEntries} entries`)
    );
    return { label: ".gitattributes", success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    spinner.warn(pc.yellow(`.gitattributes — ${pc.dim(message)}`));
    return { label: ".gitattributes", success: false, error: message };
  }
}

// ─── Pre-flight & Auto-Install ───────────────────────────────────────────────

/**
 * Check prerequisites (git, npm, npx) — these must exist, we can't install them.
 * Returns false if any are missing (abort).
 */
async function checkPrerequisites(): Promise<boolean> {
  const missing: string[] = [];
  for (const bin of PREREQUISITE_BINARIES) {
    if (!(await binaryExists(bin))) {
      missing.push(bin);
    }
  }
  if (missing.length > 0) {
    console.log();
    console.log(pc.red(pc.bold("  ✘  Missing required prerequisites:")));
    for (const bin of missing) {
      console.log(pc.red(`     • ${bin}`));
    }
    console.log();
    console.log(pc.dim("  These must be installed manually before running ai-stack."));
    console.log();
    return false;
  }
  return true;
}

/**
 * Scan for missing installable tools and offer to install them.
 * Returns structured result so the caller can decide whether to proceed.
 */
async function preflightAndInstall(autoYes: boolean, quiet: boolean): Promise<PreflightResult> {
  const spinner = ora({ text: "Scanning for installed tools…", color: "blue" }).start();

  const pythonPM = await detectPythonPM();
  const found: string[] = [];
  const missing: ToolInstaller[] = [];

  for (const tool of INSTALLABLE_TOOLS) {
    if (await binaryExists(tool.binary)) {
      found.push(tool.displayName);
    } else {
      missing.push(tool);
    }
  }

  spinner.stop();

  if (!quiet) {
    // Show found tools
    if (found.length > 0) {
      console.log(`  ${pc.green("✔")} Found on PATH: ${pc.green(found.join(", "))}`);
    }

    // Show Python package manager
    if (pythonPM) {
      console.log(`  ${pc.green("✔")} Python installer: ${pc.green(pythonPM)}`);
    } else {
      console.log(`  ${pc.yellow("⚠")} No Python package manager found (uv, pipx, or pip)`);
    }
  }

  if (missing.length === 0) {
    if (!quiet) {
      console.log();
      console.log(pc.green(pc.bold("  All tools are already installed!")));
    }
    return { found, stillMissing: [], installAttempted: false };
  }

  // ── Show missing tools ──────────────────────────────────────────────────
  console.log();
  console.log(pc.yellow(pc.bold("  ⚠  Missing tools:")));
  for (const tool of missing) {
    const pkgNote = tool.packageName !== tool.binary
      ? pc.dim(` (pkg: ${tool.packageName}, binary: ${tool.binary})`)
      : "";
    console.log(pc.yellow(`     • ${tool.displayName}${pkgNote}`));
  }
  console.log();

  // ── Ask to install ──────────────────────────────────────────────────────
  let shouldInstall = autoYes;
  if (!autoYes) {
    shouldInstall = await confirm({
      message: "Would you like to install the missing tools now?",
      default: true,
    });
  }

  if (!shouldInstall) {
    console.log(pc.dim("  Skipping auto-install. You can install them manually later."));
    return {
      found,
      stillMissing: missing.map((t) => t.displayName),
      installAttempted: false,
    };
  }

  // ── Run installs ────────────────────────────────────────────────────────
  console.log();
  console.log(pc.bold(pc.magenta("  Installing missing tools…")));
  console.log(pc.dim("  ────────────────────────────────────"));

  for (const tool of missing) {
    const step = tool.installGlobal(pythonPM);
    if (!step) {
      const s = ora({ text: `Installing ${tool.displayName}`, color: "cyan" }).start();
      s.warn(
        pc.yellow(
          `${tool.displayName} — ${pc.dim("no suitable package manager found (need uv, pipx, or pip)")}`
        )
      );
      continue;
    }

    await runStep(step, false);
  }

  // ── Re-verify installations ─────────────────────────────────────────────
  console.log();
  const recheck = ora({ text: "Verifying installations…", color: "blue" }).start();
  const stillMissing: string[] = [];
  for (const tool of missing) {
    if (!(await binaryExists(tool.binary))) {
      stillMissing.push(tool.displayName);
    }
  }
  recheck.stop();

  if (stillMissing.length === 0) {
    console.log(`  ${pc.green("✔")} All tools installed and verified on PATH`);
  } else {
    console.log(
      pc.yellow(
        `  ⚠  Still missing after install: ${pc.yellow(stillMissing.join(", "))}`
      )
    );
    console.log(
      pc.dim("  You may need to restart your terminal or add the install directory to PATH.")
    );
  }

  return { found, stillMissing, installAttempted: true };
}

// ─── Interactive Selection ───────────────────────────────────────────────────

/**
 * Resolve which agents to configure — from CLI flags, config file, or interactive prompts.
 */
async function resolveAgentSelection(
  opts: InitOptions,
  savedConfig: AiStackConfig | null,
): Promise<AgentDefinition[]> {
  // 1. CLI --agents flag takes highest priority
  if (opts.agents) {
    const ids = opts.agents.split(",").map((s) => s.trim()).filter(Boolean);
    const agents = resolveAgents(ids);
    if (agents.length === 0) {
      console.log(pc.yellow(`  ⚠  No valid agents found in: ${opts.agents}`));
      console.log(pc.dim(`     Known agents: ${allAgentIds().join(", ")}`));
      process.exitCode = 1;
      return [];
    }
    return agents;
  }

  // 2. CLI --preset flag
  if (opts.preset) {
    const preset = findPreset(opts.preset);
    if (!preset) {
      console.log(pc.yellow(`  ⚠  Unknown preset: ${opts.preset}`));
      console.log(pc.dim(`     Available: ${PRESETS.map((p) => p.name).join(", ")}`));
      process.exitCode = 1;
      return [];
    }
    return resolveAgents(preset.resolve());
  }

  // 3. Saved config (unless --reconfigure)
  if (savedConfig && !opts.reconfigure) {
    return resolveAgents(savedConfig.agents);
  }

  // 4. Auto-yes uses standard preset
  if (opts.yes) {
    const standard = findPreset("standard")!;
    return resolveAgents(standard.resolve());
  }

  // 5. Interactive: preset selection → optional custom checkbox
  console.log();
  const presetName = await select<PresetName>({
    message: "Select an agent preset:",
    choices: PRESETS.map((p) => {
      const agentList = p.name === "custom"
        ? ""
        : ` (${p.resolve().join(", ")})`;
      return {
        value: p.name,
        name: `${p.displayName} — ${p.description}${agentList}`,
      };
    }),
    default: "standard" as PresetName,
  });

  if (presetName === "custom") {
    const standardIds = findPreset("standard")!.resolve();
    const selectedIds = await checkbox<string>({
      message: "Select agents to configure:",
      choices: AGENT_REGISTRY.map((a) => ({
        value: a.id,
        name: `${a.displayName}${a.inStandardPreset ? pc.dim(" (standard)") : ""}`,
        checked: standardIds.includes(a.id),
      })),
    });

    if (selectedIds.length === 0) {
      console.log(pc.yellow("  ⚠  No agents selected. Using standard preset."));
      return resolveAgents(standardIds);
    }

    return resolveAgents(selectedIds);
  }

  const preset = findPreset(presetName)!;
  return resolveAgents(preset.resolve());
}

/**
 * Resolve which tools to configure — from CLI flags, config file, or interactive prompts.
 */
async function resolveToolSelection(
  opts: InitOptions,
  savedConfig: AiStackConfig | null,
): Promise<string[]> {
  // 1. CLI --tools flag
  if (opts.tools) {
    const ids = opts.tools.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = ids.filter((id) => TOOL_REGISTRY.some((t) => t.id === id));
    if (valid.length === 0) {
      console.log(pc.yellow(`  ⚠  No valid tools found in: ${opts.tools}`));
      console.log(pc.dim(`     Known tools: ${TOOL_REGISTRY.map((t) => t.id).join(", ")}`));
      return defaultToolIds();
    }
    return valid;
  }

  // 2. Saved config (unless --reconfigure)
  if (savedConfig && !opts.reconfigure) {
    return savedConfig.tools;
  }

  // 3. Auto-yes uses all defaults
  if (opts.yes) {
    return defaultToolIds();
  }

  // 4. Interactive: checkbox
  const selectedIds = await checkbox<string>({
    message: "Select tools to configure:",
    choices: TOOL_REGISTRY.map((t) => ({
      value: t.id,
      name: `${t.displayName} — ${pc.dim(t.description)}`,
      checked: t.defaultEnabled,
    })),
  });

  return selectedIds.length > 0 ? selectedIds : defaultToolIds();
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * Print a summary of step results.
 * Returns the number of failed steps (used to set exit code).
 */
function printSummary(results: StepResult[], quiet: boolean): number {
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log();
  console.log(pc.bold("━".repeat(50)));
  console.log(pc.bold("  Summary"));
  console.log(pc.bold("━".repeat(50)));
  console.log(`  ${pc.green("✔")} Passed: ${pc.green(String(passed))}`);
  if (failed > 0) {
    console.log(`  ${pc.yellow("⚠")} Failed: ${pc.yellow(String(failed))}`);
  }
  console.log(pc.bold("━".repeat(50)));
  console.log();

  if (failed === 0) {
    console.log(pc.green(pc.bold("  🚀 All tools initialised successfully!")));
  } else {
    console.log(
      pc.yellow(
        `  ⚠  ${failed} step(s) failed. Review output above.`
      )
    );
  }
  console.log();

  return failed;
}

// ─── Init Command ────────────────────────────────────────────────────────────

async function initCommand(opts: InitOptions): Promise<void> {
  const autoYes = opts.yes ?? false;
  const allowWarnings = opts.allowWarnings ?? false;
  const dryRun = opts.dryRun ?? false;
  const reconfigure = opts.reconfigure ?? false;
  const verbose = opts.verbose ?? false;
  const quiet = opts.quiet ?? false;

  if (!quiet) {
    console.log();
    console.log(
      pc.bold(pc.cyan("  ╔══════════════════════════════════════╗"))
    );
    console.log(
      pc.bold(pc.cyan("  ║        ai-stack  ·  project init     ║"))
    );
    console.log(
      pc.bold(pc.cyan("  ╚══════════════════════════════════════╝"))
    );
    console.log();
    console.log(
      `  ${pc.dim("Working directory:")} ${pc.white(process.cwd())}`
    );
    if (dryRun) {
      console.log(`  ${pc.magenta(pc.bold("DRY RUN"))} — no changes will be made`);
    }
    console.log();
  }

  // ── Prerequisites ───────────────────────────────────────────────────────
  if (!(await checkPrerequisites())) {
    process.exitCode = 1;
    return;
  }

  // ── Pre-flight & Auto-Install ───────────────────────────────────────────
  if (!dryRun) {
    const preflight = await preflightAndInstall(autoYes, quiet);

    // Abort if critical tools are still missing after install attempt
    if (preflight.stillMissing.length > 0 && preflight.installAttempted) {
      console.log();
      console.log(
        pc.red(
          pc.bold("  ✘  Cannot proceed — required tools are still missing after install attempt:")
        )
      );
      for (const name of preflight.stillMissing) {
        console.log(pc.red(`     • ${name}`));
      }
      console.log();
      console.log(
        pc.dim("  Fix your PATH or install the tools manually, then re-run `ai-stack init`.")
      );
      console.log();
      process.exitCode = 1;
      return;
    }

    // If user declined install and tools are missing, warn but continue
    // (the individual steps will fail gracefully with warnings)
    if (preflight.stillMissing.length > 0 && !preflight.installAttempted) {
      console.log();
      console.log(
        pc.yellow(
          pc.bold("  ⚠  Continuing with missing tools — some steps will fail.")
        )
      );
      console.log();
    }
  }

  // ── Load saved config ──────────────────────────────────────────────────
  let savedConfig: AiStackConfig | null = null;
  if (!reconfigure) {
    savedConfig = loadConfig(process.cwd());
    if (savedConfig && !quiet && !autoYes) {
      console.log();
      console.log(`  ${pc.green("✔")} Found saved config: ${pc.dim(configPath(process.cwd()))}`);
      console.log(`    Agents: ${pc.cyan(savedConfig.agents.join(", "))}`);
      console.log(`    Tools:  ${pc.cyan(savedConfig.tools.join(", "))}`);

      const useSaved = await confirm({
        message: "Use saved configuration?",
        default: true,
      });

      if (!useSaved) {
        savedConfig = null;
      }
    }
  }

  // ── Resolve selections ──────────────────────────────────────────────────
  const selectedAgents = await resolveAgentSelection(opts, savedConfig);
  if (selectedAgents.length === 0) return;

  const selectedToolIds = await resolveToolSelection(opts, savedConfig);

  if (!quiet) {
    console.log();
    console.log(`  ${pc.blue("Agents:")} ${selectedAgents.map((a) => pc.cyan(a.displayName)).join(", ")}`);
    console.log(`  ${pc.blue("Tools:")}  ${selectedToolIds.map((t) => pc.cyan(t)).join(", ")}`);
  }

  // ── Offer to save config ───────────────────────────────────────────────
  if (!savedConfig && !dryRun) {
    let shouldSave = autoYes;
    if (!autoYes && !quiet) {
      shouldSave = await confirm({
        message: "Save these selections to .ai-stackrc.json for next time?",
        default: true,
      });
    }

    if (shouldSave) {
      const config = buildConfig(
        selectedAgents.map((a) => a.id),
        selectedToolIds,
        DEFAULT_AGENT_ID,
      );
      saveConfig(process.cwd(), config);
      if (!quiet) {
        console.log(`  ${pc.green("✔")} Saved ${pc.dim(configPath(process.cwd()))}`);
      }
    }
  }

  // ── Build setup plan ───────────────────────────────────────────────────
  const plan = buildSetupPlan({
    autoYes,
    selectedAgents,
    selectedTools: selectedToolIds,
  });

  const results: StepResult[] = [];

  // ── Phase A: Standard Tools ────────────────────────────────────────────
  if (plan.standardToolSteps.length > 0) {
    if (!quiet) {
      console.log();
      console.log(pc.bold(pc.blue(`  Phase A: Standard Tools${dryRun ? " (DRY RUN)" : ""}`)));
      console.log(pc.dim("  ────────────────────────────────────"));
    }
    for (const step of plan.standardToolSteps) {
      results.push(dryRun ? dryRunStep(step) : await runStep(step, verbose));
    }
  }

  // ── Phase B: Graphify Hooks ────────────────────────────────────────────
  if (plan.graphifyHookSteps.length > 0) {
    if (!quiet) {
      console.log();
      console.log(pc.bold(pc.blue(`  Phase B: Graphify Hooks${dryRun ? " (DRY RUN)" : ""}`)));
      console.log(pc.dim("  ────────────────────────────────────"));
    }
    results.push(await ensureGitRepo(dryRun));
    for (const step of plan.graphifyHookSteps) {
      results.push(dryRun ? dryRunStep(step) : await runStep(step, verbose));
    }
  }

  // ── Phase C: Git Hygiene ───────────────────────────────────────────────
  if (!quiet) {
    console.log();
    console.log(pc.bold(pc.blue(`  Phase C: Git Hygiene${dryRun ? " (DRY RUN)" : ""}`)));
    console.log(pc.dim("  ────────────────────────────────────"));
  }
  results.push(ensureGitignore(dryRun));
  results.push(ensureGitattributes(dryRun));

  // ── Phase D: AI Integrations ───────────────────────────────────────────
  if (plan.integrationSteps.length > 0) {
    if (!quiet) {
      console.log();
      console.log(pc.bold(pc.blue(`  Phase D: AI Integrations${dryRun ? " (DRY RUN)" : ""}`)));
      console.log(pc.dim("  ────────────────────────────────────"));
    }
    for (const step of plan.integrationSteps) {
      results.push(dryRun ? dryRunStep(step) : await runStep(step, verbose));
    }
  }

  // ── Summary & Exit Code ─────────────────────────────────────────────────
  const failedCount = printSummary(results, quiet);

  if (shouldSetFailureExitCode(failedCount, allowWarnings)) {
    process.exitCode = 1;
  }
}

// ─── CLI Program ─────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("ai-stack")
  .version(VERSION)
  .description(
    "Bootstrap AI and developer workflow tools for the current project."
  );

program
  .command("init")
  .description(
    "Initialise all AI & dev-workflow tools in the current working directory."
  )
  .option("-y, --yes", "Skip all prompts — auto-install missing tools globally")
  .option("--allow-warnings", "Exit 0 even if some steps fail (default: exit 1 on failures)")
  .option("--dry-run", "Show what would happen without making changes")
  .option("--preset <name>", "Use a preset: standard, minimal, all (skips agent prompt)")
  .option("--agents <list>", "Comma-separated agent IDs (overrides preset)")
  .option("--tools <list>", "Comma-separated tool IDs")
  .option("--reconfigure", "Ignore saved .ai-stackrc.json and re-prompt")
  .option("--verbose", "Show command output for each step")
  .option("--quiet", "Minimal output — only errors and summary")
  .action(initCommand);

program.parse(process.argv);
