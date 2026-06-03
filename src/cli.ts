#!/usr/bin/env node

import { Command } from "commander";
import { execa } from "execa";
import ora, { type Ora } from "ora";
import pc from "picocolors";
import { confirm } from "@inquirer/prompts";

// ─── Constants ───────────────────────────────────────────────────────────────

const VERSION = "1.0.0";

/** AI platforms that graphify integrates with. */
const AI_PLATFORMS = [
  "codex",
  "gemini",
  "antigravity",
  "opencode",
  "claude",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepDefinition {
  /** Human-readable label shown in the spinner. */
  label: string;
  /** The command to execute (first element = binary). */
  command: string;
  /** Arguments to pass. */
  args: string[];
}

interface StepResult {
  label: string;
  success: boolean;
  error?: string;
}

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
async function ensureGitRepo(): Promise<boolean> {
  const spinner = ora({ text: "Checking for git repository…", color: "blue" }).start();

  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    spinner.succeed(pc.green("Git repository detected"));
    return true;
  } catch {
    spinner.text = "No git repo found — running git init…";
    try {
      await execa("git", ["init"], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      spinner.succeed(pc.green("Initialised new git repository"));
      return false;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      spinner.warn(pc.yellow(`Failed to initialise git repo — ${pc.dim(message)}`));
      return false;
    }
  }
}

/**
 * Run a single setup step with a terminal spinner.
 * On failure the error is captured and the spinner shows a warning.
 */
async function runStep(step: StepDefinition): Promise<StepResult> {
  const spinner: Ora = ora({ text: step.label, color: "cyan" }).start();

  try {
    await execa(step.command, step.args, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    spinner.succeed(pc.green(step.label));
    return { label: step.label, success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    spinner.warn(pc.yellow(`${step.label} — ${pc.dim(message)}`));
    return { label: step.label, success: false, error: message };
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
async function preflightAndInstall(autoYes: boolean): Promise<PreflightResult> {
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

  if (missing.length === 0) {
    console.log();
    console.log(pc.green(pc.bold("  All tools are already installed!")));
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

    await runStep(step);
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

// ─── Step Definitions ────────────────────────────────────────────────────────

function buildSetupSteps(autoYes: boolean): StepDefinition[] {
  const steps: StepDefinition[] = [];

  // Phase A: Standard Tools
  const superForce = autoYes ? ["--force"] : [];
  steps.push(
    { label: "Installing codebase-memory-mcp",    command: "codebase-memory-mcp", args: ["install", "-y"] },
    { label: "Initialising superpowers",           command: "npx",                  args: ["-y", "antigravity-superpowers", "init", ...superForce] },
    { label: "Installing caveman skill",           command: "npx",                  args: ["-y", "skills", "add", "JuliusBrussee/caveman", "--yes", "--agent", "*", "--skill", "*"] },
    { label: "Initialising code-review-graph",     command: "code-review-graph",    args: ["init"] },
    { label: "Initialising echovault",             command: "memory",               args: ["init"] },
  );

  // Phase B: Graphify Hooks
  steps.push(
    { label: "Installing graphify git hooks",      command: "graphify",             args: ["hook", "install"] },
  );

  // Phase C: AI Integrations
  for (const platform of AI_PLATFORMS) {
    steps.push({
      label: `Integrating graphify → ${platform}`,
      command: "graphify",
      args: [platform, "install"],
    });
  }

  return steps;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/**
 * Print a summary of step results.
 * Returns the number of failed steps (used to set exit code).
 */
function printSummary(results: StepResult[]): number {
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

async function initCommand(opts: { yes?: boolean; allowWarnings?: boolean }): Promise<void> {
  const autoYes = opts.yes ?? false;
  const allowWarnings = opts.allowWarnings ?? false;

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
  console.log();

  // ── Prerequisites ───────────────────────────────────────────────────────
  if (!(await checkPrerequisites())) {
    process.exitCode = 1;
    return;
  }

  // ── Pre-flight & Auto-Install ───────────────────────────────────────────
  const preflight = await preflightAndInstall(autoYes);

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

  // ── Execute setup steps ─────────────────────────────────────────────────
  const steps = buildSetupSteps(autoYes);
  const results: StepResult[] = [];

  // Phase A header
  console.log();
  console.log(pc.bold(pc.blue("  Phase A: Standard Tools")));
  console.log(pc.dim("  ────────────────────────────────────"));
  for (const step of steps.slice(0, 5)) {
    results.push(await runStep(step));
  }

  // Phase B header
  console.log();
  console.log(pc.bold(pc.blue("  Phase B: Graphify Hooks")));
  console.log(pc.dim("  ────────────────────────────────────"));
  await ensureGitRepo();
  for (const step of steps.slice(5, 6)) {
    results.push(await runStep(step));
  }

  // Phase C header
  console.log();
  console.log(pc.bold(pc.blue("  Phase C: AI Integrations")));
  console.log(pc.dim("  ────────────────────────────────────"));
  for (const step of steps.slice(6)) {
    results.push(await runStep(step));
  }

  // ── Summary & Exit Code ─────────────────────────────────────────────────
  const failedCount = printSummary(results);

  if (failedCount > 0 && !allowWarnings) {
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
  .action(initCommand);

program.parse(process.argv);
