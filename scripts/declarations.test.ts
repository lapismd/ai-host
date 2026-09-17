import { expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

it("preserves typed public contracts for a NodeNext consumer", () => {
  execFileSync("pnpm", ["build"], { cwd: resolve("."), stdio: "pipe" });
  const directory = mkdtempSync(resolve(".declaration-test-"));
  try {
    const source = join(directory, "consumer.mts");
    writeFileSync(
      source,
      `import { createAcpAgentRegistry, type AcpAgentDefinition, type AgentRuntimeExecutor } from "../dist/index.js";
const registry = createAcpAgentRegistry();
const entries: AcpAgentDefinition[] = registry.list();
// @ts-expect-error Agent IDs are strings, not numbers.
const invalid: AcpAgentDefinition = { id: 3 };
// @ts-expect-error The registry does not return a number.
const count: number = registry.list();
declare const executor: AgentRuntimeExecutor;
// @ts-expect-error Prompt text is required to be a string.
executor.promptAcpSession({}, "session", 3);
void entries; void invalid; void count;
`,
    );
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsc",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        source,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
