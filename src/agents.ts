// ─── Agent Registry ──────────────────────────────────────────────────────────
// Single source of truth for every coding-agent platform ai-stack knows about.
// Each entry records the platform IDs that code-review-graph and graphify
// accept, so step generation can skip unsupported integrations automatically.

export interface AgentDefinition {
  /** Stable identifier used in CLI flags, config, and presets. */
  id: string;
  /** Human-friendly name shown in prompts and output. */
  displayName: string;
  /**
   * Platform value for `code-review-graph init --platform <X>`.
   * `null` when CRG does not support this agent.
   */
  codeReviewGraphPlatform: string | null;
  /**
   * Sub-command for `graphify <X> install`.
   * `null` when graphify does not support this agent.
   */
  graphifyPlatform: string | null;
  /** Whether this agent is included in the "standard" preset. */
  inStandardPreset: boolean;
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Ordered: standard-preset agents first (alphabetical), then extras.

export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  // ── Standard preset ────────────────────────────────────────────────────
  { id: "opencode",    displayName: "OpenCode",       codeReviewGraphPlatform: "opencode",    graphifyPlatform: "opencode",    inStandardPreset: true },

  // ── Extended agents ────────────────────────────────────────────────────
  { id: "antigravity", displayName: "Antigravity",    codeReviewGraphPlatform: "antigravity", graphifyPlatform: "antigravity", inStandardPreset: false },
  { id: "claude",      displayName: "Claude Code",    codeReviewGraphPlatform: "claude",      graphifyPlatform: "claude",      inStandardPreset: false },
  { id: "codex",       displayName: "Codex CLI",      codeReviewGraphPlatform: "codex",       graphifyPlatform: "codex",       inStandardPreset: false },
  { id: "gemini-cli",  displayName: "Gemini CLI",     codeReviewGraphPlatform: "gemini-cli",  graphifyPlatform: "gemini",      inStandardPreset: false },
  { id: "aider",       displayName: "Aider",          codeReviewGraphPlatform: null,           graphifyPlatform: "aider",       inStandardPreset: false },
  { id: "continue",    displayName: "Continue",       codeReviewGraphPlatform: "continue",     graphifyPlatform: null,          inStandardPreset: false },
  { id: "copilot",     displayName: "GitHub Copilot", codeReviewGraphPlatform: "copilot",      graphifyPlatform: "copilot",     inStandardPreset: false },
  { id: "cursor",      displayName: "Cursor",         codeReviewGraphPlatform: "cursor",       graphifyPlatform: "cursor",      inStandardPreset: false },
  { id: "hermes",      displayName: "Hermes",         codeReviewGraphPlatform: null,           graphifyPlatform: "hermes",      inStandardPreset: false },
  { id: "kiro",        displayName: "Kiro",           codeReviewGraphPlatform: "kiro",         graphifyPlatform: "kiro",        inStandardPreset: false },
  { id: "pi",          displayName: "Pi.dev",         codeReviewGraphPlatform: null,           graphifyPlatform: "pi",          inStandardPreset: false },
  { id: "qoder",       displayName: "Qoder",          codeReviewGraphPlatform: "qoder",        graphifyPlatform: null,          inStandardPreset: false },
  { id: "windsurf",    displayName: "Windsurf",       codeReviewGraphPlatform: "windsurf",     graphifyPlatform: null,          inStandardPreset: false },
  { id: "zed",         displayName: "Zed",            codeReviewGraphPlatform: "zed",          graphifyPlatform: null,          inStandardPreset: false },
] as const;

// ── Presets ──────────────────────────────────────────────────────────────────

export type PresetName = "standard" | "minimal" | "all" | "custom";

/** The agent that the "minimal" preset resolves to. */
export const DEFAULT_AGENT_ID = "opencode";

export interface PresetDefinition {
  name: PresetName;
  displayName: string;
  description: string;
  /** Agent IDs for this preset, or the literal `"all"`. */
  resolve: () => string[];
}

export const PRESETS: readonly PresetDefinition[] = [
  {
    name: "standard",
    displayName: "Standard",
    description: "Recommended — popular agents",
    resolve: () => AGENT_REGISTRY.filter((a) => a.inStandardPreset).map((a) => a.id),
  },
  {
    name: "minimal",
    displayName: "Minimal",
    description: `Just ${AGENT_REGISTRY.find((a) => a.id === DEFAULT_AGENT_ID)!.displayName}`,
    resolve: () => [DEFAULT_AGENT_ID],
  },
  {
    name: "all",
    displayName: "All agents",
    description: "Every known agent",
    resolve: () => AGENT_REGISTRY.map((a) => a.id),
  },
  {
    name: "custom",
    displayName: "Custom",
    description: "Pick individually",
    resolve: () => [],  // resolved interactively
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Look up full agent definitions by their IDs.
 * Unknown IDs are silently dropped.
 */
export function resolveAgents(ids: readonly string[]): AgentDefinition[] {
  return ids
    .map((id) => AGENT_REGISTRY.find((a) => a.id === id))
    .filter((a): a is AgentDefinition => a !== undefined);
}

/** Return all known agent IDs. */
export function allAgentIds(): string[] {
  return AGENT_REGISTRY.map((a) => a.id);
}

/** Look up a preset by name, or `undefined`. */
export function findPreset(name: string): PresetDefinition | undefined {
  return PRESETS.find((p) => p.name === name);
}
