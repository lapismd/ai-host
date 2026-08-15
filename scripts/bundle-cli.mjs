import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(packageRoot, "src/cli.ts")],
  outfile: path.join(packageRoot, "dist/cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  external: ["acpx", "ws"],
});

console.log("[ai-host] cli bundle written");
