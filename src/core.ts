import type {
  StepDefinition,
  StepResult,
  ManagedGroup,
  ManagedMergeResult,
  GitRepoStatus,
} from "./types.js";

import type { AgentDefinition } from "./agents.js";

export type {
  StepDefinition,
  StepResult,
  ManagedGroup,
  ManagedMergeResult,
  GitRepoStatus,
};

// ─── Tool Registry ───────────────────────────────────────────────────────────
// Selectable tools that ai-stack can configure per-project.

export interface ToolDefinition {
  id: string;
  displayName: string;
  description: string;
  defaultEnabled: boolean;
}

export const TOOL_REGISTRY: readonly ToolDefinition[] = [
  { id: "code-review-graph", displayName: "code-review-graph", description: "AI-powered code review",   defaultEnabled: true },
  { id: "graphify",          displayName: "graphify",          description: "Knowledge graph + git hooks", defaultEnabled: true },
  { id: "echovault",         displayName: "echovault",         description: "Persistent memory",           defaultEnabled: true },
  { id: "codebase-memory",   displayName: "codebase-memory-mcp", description: "MCP code indexer",         defaultEnabled: true },
];

export function defaultToolIds(): string[] {
  return TOOL_REGISTRY.filter((t) => t.defaultEnabled).map((t) => t.id);
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const MANAGED_BLOCK_HEADER =
  "# === ai-stack managed - do not remove this block ===";

export const GITIGNORE_GROUPS: readonly ManagedGroup[] = [
  {
    comment: "# Security and hygiene (do not commit to history)",
    entries: [".env", ".env.*", "*.log", ".DS_Store", "node_modules/", "coverage/"],
  },
  {
    comment: "# code-review-graph local database",
    entries: [".code-review-graph/"],
  },
  {
    comment: "# graphify generated knowledge graph",
    entries: ["graphify-out/"],
  },
  {
    comment: "# echovault local memory index",
    entries: [".memory/"],
  },
];

export const GITATTRIBUTES_GROUPS: readonly ManagedGroup[] = [
  {
    comment: "# Security and hygiene (prevent accidental export)",
    entries: [
      ".env* export-ignore",
      "*.log export-ignore",
      ".DS_Store export-ignore",
    ],
  },
  {
    comment: "# Generated knowledge graph output",
    entries: [
      "graphify-out/** linguist-generated=true",
      ".code-review-graph/** linguist-generated=true",
    ],
  },
];

// ─── Managed Block Merge ─────────────────────────────────────────────────────

function exactLines(content: string): Set<string> {
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

export function mergeManagedBlock(
  content: string,
  header: string,
  groups: readonly ManagedGroup[]
): ManagedMergeResult {
  const existingLines = exactLines(content);
  const additions: string[] = [];
  let addedEntries = 0;

  for (const group of groups) {
    const missingEntries = group.entries.filter(
      (entry) => !existingLines.has(entry)
    );
    if (missingEntries.length === 0) continue;

    if (!existingLines.has(group.comment)) {
      additions.push(group.comment);
      existingLines.add(group.comment);
    }
    additions.push(...missingEntries, "");
    for (const entry of missingEntries) existingLines.add(entry);
    addedEntries += missingEntries.length;
  }

  if (addedEntries === 0) {
    return { content, changed: false, addedEntries: 0 };
  }

  const block: string[] = [];
  if (!existingLines.has(header)) block.push(header);
  block.push(...additions);

  const prefix = content.length === 0
    ? ""
    : `${content.endsWith("\n") ? content : `${content}\n`}\n`;

  return {
    content: `${prefix}${block.join("\n")}`,
    changed: true,
    addedEntries,
  };
}

// ─── Git Repo Step ───────────────────────────────────────────────────────────

export function gitRepoStepResult(
  status: GitRepoStatus,
  error?: string
): StepResult {
  if (status === "failed") {
    return {
      label: "Git repository",
      success: false,
      error: error ?? "Failed to initialize Git repository",
    };
  }

  return {
    label: status === "detected"
      ? "Git repository detected"
      : "Git repository initialized",
    success: true,
  };
}

// ─── Exit Code ───────────────────────────────────────────────────────────────

export function shouldSetFailureExitCode(
  failedCount: number,
  allowWarnings: boolean
): boolean {
  return failedCount > 0 && !allowWarnings;
}

// ─── Setup Plan ──────────────────────────────────────────────────────────────
// Replaces the old `buildSetupSteps()` with a structured plan driven by
// user-selected agents and tools.

export interface SetupPlan {
  /** Phase A: code-review-graph init + echovault init */
  standardToolSteps: StepDefinition[];
  /** Phase B: graphify git hooks */
  graphifyHookSteps: StepDefinition[];
  /** Phase D: graphify <platform> install for each agent */
  integrationSteps: StepDefinition[];
}

export interface BuildPlanOptions {
  autoYes: boolean;
  selectedAgents: AgentDefinition[];
  selectedTools: string[];
}

/**
 * Build a structured setup plan based on user selections.
 */
export function buildSetupPlan(options: BuildPlanOptions): SetupPlan {
  const { autoYes, selectedAgents, selectedTools } = options;
  const reviewGraphYes = autoYes ? ["-y"] : [];

  const hasCRG = selectedTools.includes("code-review-graph");
  const hasGraphify = selectedTools.includes("graphify");
  const hasEchovault = selectedTools.includes("echovault");

  // Phase A: Standard tool steps
  const standardToolSteps: StepDefinition[] = [];

  if (hasCRG) {
    for (const agent of selectedAgents) {
      if (agent.codeReviewGraphPlatform) {
        standardToolSteps.push({
          label: `Initialising code-review-graph -> ${agent.codeReviewGraphPlatform}`,
          command: "code-review-graph",
          args: ["init", "--platform", agent.codeReviewGraphPlatform, ...reviewGraphYes],
        });
      }
    }
  }

  if (hasEchovault) {
    standardToolSteps.push({
      label: "Initialising echovault",
      command: "memory",
      args: ["init"],
    });
  }

  // Phase B: Graphify hooks
  const graphifyHookSteps: StepDefinition[] = [];

  if (hasGraphify) {
    graphifyHookSteps.push({
      label: "Installing graphify git hooks",
      command: "graphify",
      args: ["hook", "install"],
    });
  }

  // Phase D: AI integrations (graphify -> agent)
  const integrationSteps: StepDefinition[] = [];

  if (hasGraphify) {
    for (const agent of selectedAgents) {
      if (agent.graphifyPlatform) {
        integrationSteps.push({
          label: `Integrating graphify -> ${agent.graphifyPlatform}`,
          command: "graphify",
          args: [agent.graphifyPlatform, "install"],
        });
      }
    }
  }

  return { standardToolSteps, graphifyHookSteps, integrationSteps };
}

// ─── Legacy Compatibility ────────────────────────────────────────────────────
// The old `buildSetupSteps()` API used by existing tests.
// Delegates to `buildSetupPlan()` with the original hardcoded agents.

const LEGACY_AI_PLATFORMS = [
  "codex",
  "gemini",
  "antigravity",
  "claude",
] as const;

const LEGACY_CODE_REVIEW_GRAPH_PLATFORMS = [
  "codex",
  "gemini-cli",
  "antigravity",
  "claude",
] as const;

export const STANDARD_TOOL_STEP_COUNT =
  LEGACY_CODE_REVIEW_GRAPH_PLATFORMS.length + 1;

/**
 * @deprecated Use `buildSetupPlan()` instead.
 * Kept for backward compatibility with existing tests.
 */
export function buildSetupSteps(autoYes: boolean): StepDefinition[] {
  const reviewGraphYes = autoYes ? ["-y"] : [];
  const steps: StepDefinition[] = [];

  for (const platform of LEGACY_CODE_REVIEW_GRAPH_PLATFORMS) {
    steps.push({
      label: `Initialising code-review-graph -> ${platform}`,
      command: "code-review-graph",
      args: ["init", "--platform", platform, ...reviewGraphYes],
    });
  }

  steps.push(
    {
      label: "Initialising echovault",
      command: "memory",
      args: ["init"],
    },
    {
      label: "Installing graphify git hooks",
      command: "graphify",
      args: ["hook", "install"],
    }
  );

  for (const platform of LEGACY_AI_PLATFORMS) {
    steps.push({
      label: `Integrating graphify -> ${platform}`,
      command: "graphify",
      args: [platform, "install"],
    });
  }

  return steps;
}
