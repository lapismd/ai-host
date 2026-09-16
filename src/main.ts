import { runMcpShim } from "./mcp-shim";
import { runCli } from "./cli";
const deno = (
  globalThis as { Deno?: { args: string[]; exit(code: number): never } }
).Deno;
const argv = deno?.args ?? process.argv.slice(2);
if (argv[0] === "__internal" && argv[1] === "mcp-shim") await runMcpShim();
else {
  const code = await runCli(argv);
  if (code !== 0) {
    if (deno) deno.exit(code);
    else process.exitCode = code;
  }
}
