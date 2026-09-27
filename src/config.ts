// ─── .ai-stackrc.json ────────────────────────────────────────────────────────
// Persists user selections so subsequent `ai-stack init` runs can skip prompts.
// The file lives at the project root and is intended to be committed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILENAME = ".ai-stackrc.json";
const CONFIG_VERSION = 1;

export interface AiStackConfig {
  version: number;
  agents: string[];
  tools: string[];
  defaultAgent: string;
}

/** Return the absolute path to the config file for a given project root. */
export function configPath(cwd: string): string {
  return join(cwd, CONFIG_FILENAME);
}

/**
 * Try to load an existing config.
 * Returns `null` when the file is missing, unreadable, or has an incompatible version.
 */
export function loadConfig(cwd: string): AiStackConfig | null {
  const filePath = configPath(cwd);
  if (!existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    if (raw.version !== CONFIG_VERSION) return null;
    if (!Array.isArray(raw.agents) || !Array.isArray(raw.tools)) return null;
    return raw as AiStackConfig;
  } catch {
    return null;
  }
}

/** Write config to disk. */
export function saveConfig(cwd: string, config: AiStackConfig): void {
  const filePath = configPath(cwd);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Build a config object from selections. */
export function buildConfig(
  agents: string[],
  tools: string[],
  defaultAgent: string,
): AiStackConfig {
  return {
    version: CONFIG_VERSION,
    agents,
    tools,
    defaultAgent,
  };
}
