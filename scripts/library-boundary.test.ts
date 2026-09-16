import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
import { resolve } from "node:path";
it("publishes transport libraries without an operator executable", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.bin).toBeUndefined();
  expect(manifest.scripts["serve:local"]).toBeUndefined();
  expect(manifest.scripts["build:cli"]).toBeUndefined();
  expect(existsSync(resolve("src/main.ts"))).toBe(false);
  expect(existsSync(resolve("bin/lapis-ai-host.mjs"))).toBe(false);
  expect(manifest.exports["."].import).toBe("./dist/index.js");
  expect(manifest.exports["./file-tools"].import).toBe(
    "./dist/file-tools/index.js",
  );
});
