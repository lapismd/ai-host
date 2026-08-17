#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const shim = join(packageRoot, "dist/mcp-shim.js");
if (!existsSync(shim)) {
  console.error(
    "lapis-mcp-shim: build the package first (`pnpm --filter @lapis-notes/ai-host build`).",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [shim, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
