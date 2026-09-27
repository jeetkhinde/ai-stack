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
