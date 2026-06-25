export interface StepDefinition {
  label: string;
  command: string;
  args: string[];
}

export interface StepResult {
  label: string;
  success: boolean;
  error?: string;
}

export interface ManagedGroup {
  comment: string;
  entries: readonly string[];
}

export interface ManagedMergeResult {
  content: string;
  changed: boolean;
  addedEntries: number;
}

export type GitRepoStatus = "detected" | "initialized" | "failed";

const AI_PLATFORMS = [
  "codex",
  "gemini",
  "antigravity",
  "claude",
] as const;

export const MANAGED_BLOCK_HEADER =
  "# === ai-stack managed - do not remove this block ===";

export const GITIGNORE_GROUPS: readonly ManagedGroup[] = [
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
    comment: "# Generated knowledge graph output",
    entries: [
      "graphify-out/** linguist-generated=true",
      ".code-review-graph/** linguist-generated=true",
    ],
  },
];

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

export function shouldSetFailureExitCode(
  failedCount: number,
  allowWarnings: boolean
): boolean {
  return failedCount > 0 && !allowWarnings;
}

export function buildSetupSteps(autoYes: boolean): StepDefinition[] {
  const superForce = autoYes ? ["--force"] : [];
  const reviewGraphYes = autoYes ? ["-y"] : [];
  const steps: StepDefinition[] = [
    {
      label: "Installing codebase-memory-mcp",
      command: "codebase-memory-mcp",
      args: ["install", "-y"],
    },
    {
      label: "Initialising superpowers",
      command: "npx",
      args: ["-y", "antigravity-superpowers", "init", ...superForce],
    },
    {
      label: "Initialising code-review-graph",
      command: "code-review-graph",
      args: ["init", ...reviewGraphYes],
    },
    {
      label: "Initialising echovault",
      command: "memory",
      args: ["init"],
    },
    {
      label: "Installing graphify git hooks",
      command: "graphify",
      args: ["hook", "install"],
    },
  ];

  for (const platform of AI_PLATFORMS) {
    steps.push({
      label: `Integrating graphify -> ${platform}`,
      command: "graphify",
      args: [platform, "install"],
    });
  }

  return steps;
}
