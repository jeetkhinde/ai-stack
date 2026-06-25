import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import {
  buildSetupSteps,
  GITATTRIBUTES_GROUPS,
  GITIGNORE_GROUPS,
  gitRepoStepResult,
  mergeManagedBlock,
  shouldSetFailureExitCode,
} from "../dist/core.js";

const TEST_GROUPS = [
  {
    comment: "# Generated cache",
    entries: [".cache/", "report.json"],
  },
];

test("mergeManagedBlock adds a header, comments, and missing entries", () => {
  const result = mergeManagedBlock(
    "node_modules/\n",
    "# === managed ===",
    TEST_GROUPS
  );

  assert.equal(result.changed, true);
  assert.equal(result.addedEntries, 2);
  assert.equal(
    result.content,
    [
      "node_modules/",
      "",
      "# === managed ===",
      "# Generated cache",
      ".cache/",
      "report.json",
      "",
    ].join("\n")
  );
});

test("mergeManagedBlock matches active lines exactly", () => {
  const result = mergeManagedBlock(
    "# .cache/ is discussed here\nnested/.cache/\n",
    "# === managed ===",
    TEST_GROUPS
  );

  assert.equal(result.addedEntries, 2);
  assert.match(result.content, /^\.cache\/$/m);
  assert.match(result.content, /^report\.json$/m);
});

test("mergeManagedBlock is idempotent", () => {
  const first = mergeManagedBlock("", "# === managed ===", TEST_GROUPS);
  const second = mergeManagedBlock(
    first.content,
    "# === managed ===",
    TEST_GROUPS
  );

  assert.equal(second.changed, false);
  assert.equal(second.addedEntries, 0);
  assert.equal(second.content, first.content);
});

test("buildSetupSteps makes code-review-graph non-interactive with --yes", () => {
  const steps = buildSetupSteps(true);
  const step = steps.find((candidate) =>
    candidate.label.includes("code-review-graph")
  );

  assert.deepEqual(step?.args, ["init", "-y"]);
});

test("buildSetupSteps keeps code-review-graph interactive by default", () => {
  const steps = buildSetupSteps(false);
  const step = steps.find((candidate) =>
    candidate.label.includes("code-review-graph")
  );

  assert.deepEqual(step?.args, ["init"]);
});

test("gitRepoStepResult reports initialization failure", () => {
  assert.deepEqual(gitRepoStepResult("failed", "permission denied"), {
    label: "Git repository",
    success: false,
    error: "permission denied",
  });
});

test("failed steps set a failure exit code unless warnings are allowed", () => {
  assert.equal(shouldSetFailureExitCode(1, false), true);
  assert.equal(shouldSetFailureExitCode(1, true), false);
  assert.equal(shouldSetFailureExitCode(0, false), false);
});

test("managed hygiene preserves project instructions and shareable config", () => {
  const ignored = GITIGNORE_GROUPS.flatMap((group) => group.entries);
  const attributes = GITATTRIBUTES_GROUPS.flatMap((group) => group.entries);

  assert.equal(ignored.includes("AGENTS.md"), false);
  assert.equal(ignored.includes(".mcp.json"), false);
  assert.equal(attributes.some((line) => line.includes("merge=")), false);
});

test("setup contains only the supported standard tools", () => {
  const steps = buildSetupSteps(true);
  const ignored = GITIGNORE_GROUPS.flatMap((group) => group.entries);

  assert.deepEqual(
    steps.slice(0, 4).map((step) => step.command),
    ["codebase-memory-mcp", "npx", "code-review-graph", "memory"]
  );
  assert.deepEqual(ignored, [
    ".code-review-graph/",
    "graphify-out/",
    ".memory/",
  ]);
});

test("graphify integrations target only the supported agent toolchain", () => {
  const integrationSteps = buildSetupSteps(true).filter(
    (step) => step.label.startsWith("Integrating graphify -> ")
  );

  assert.deepEqual(
    integrationSteps.map((step) => step.args[0]),
    ["codex", "gemini", "antigravity", "claude"]
  );
  assert.equal(
    integrationSteps.some((step) =>
      ["qoder", "opencode", "kiro", "cursor", "windsurf"].includes(step.args[0])
    ),
    false
  );
});

test("package metadata requires a supported Node version", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(
    packageJson.engines?.node,
    ">=20.17.0 <21 || >=22.13.0 <23 || >=23.5.0"
  );
});

test("package includes an MIT license file", () => {
  assert.match(readFileSync("LICENSE", "utf8"), /MIT License/);
});

test("compiled CLI is executable", () => {
  assert.notEqual(statSync("dist/cli.js").mode & 0o111, 0);
});
