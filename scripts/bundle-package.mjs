import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { normalizeDeclarationImports } from "./declaration-imports.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const externalPackages = ["@modelcontextprotocol/sdk/*", "acpx", "ws"];

async function bundle(entry, outfile, options = {}) {
  await build({
    entryPoints: [path.join(packageRoot, entry)],
    outfile: path.join(packageRoot, outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: externalPackages,
    ...options,
  });
}

await normalizeDeclarationImports(path.join(packageRoot, "dist"));

await bundle("src/index.ts", "dist/index.js");
await bundle("src/client.ts", "dist/client.js");
await bundle("src/file-tools/index.ts", "dist/file-tools/index.js");

await bundle("src/mcp-shim-cli.ts", "dist/mcp-shim.js", {
  banner: { js: "#!/usr/bin/env node" },
});

console.log("[ai-host] transport library and private MCP shim bundles written");
