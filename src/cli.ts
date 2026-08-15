import { formatCliHelp, parseServeArgs } from "./parse-cli";
import { serveAgentHost } from "./serve";

export async function runCli(
  argv: string[],
  options?: { stdout?: (line: string) => void; stderr?: (line: string) => void },
): Promise<number> {
  const parsed = parseServeArgs(argv);
  if (!parsed.ok && "help" in parsed) {
    (options?.stdout ?? console.log)(formatCliHelp());
    return 0;
  }
  if (!parsed.ok) {
    (options?.stderr ?? console.error)(parsed.error);
    return 2;
  }

  const host = await serveAgentHost(parsed.args, { print: options?.stdout });
  const shutdown = async () => {
    await host.close();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
  return 0;
}

void runCli(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
});
