import { runMcpShim } from "./mcp-shim";

runMcpShim().catch((error) => {
  console.error(
    `[lapis-mcp-shim] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
