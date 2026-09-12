import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAcpAgentRegistry, parseAcpAgentDefinitions } from "./acp-agent";
import { createAgentRuntimeExecutor } from "./executor";
import type { ServeArgs } from "./parse-cli";
import { generateToken } from "./token";
import { startAgentRuntimeServer, type AgentRuntimeServer } from "./ws-server";

export type RunningAgentHost = {
  token: string;
  url: string;
  workspace: string;
  generatedToken: boolean;
  disconnectClients(): void;
  close(): Promise<void>;
};

export async function serveAgentHost(
  args: ServeArgs,
  options?: {
    executor?: ReturnType<typeof createAgentRuntimeExecutor>;
    print?: (line: string) => void;
  },
): Promise<RunningAgentHost> {
  const provided = args.token?.trim() ?? "";
  const generatedToken = provided.length === 0;
  const token = generatedToken ? generateToken() : provided;
  if (!token) {
    throw new Error("lapis-ai-host serve requires a token");
  }

  const workspace = resolve(args.workspace);
  await mkdir(workspace, { recursive: true });
  const agentRegistry = args.agentConfig
    ? createAcpAgentRegistry(
        parseAcpAgentDefinitions(
          JSON.parse(
            await readFile(resolve(args.agentConfig), "utf8"),
          ) as unknown,
        ),
      )
    : undefined;

  const server: AgentRuntimeServer = await startAgentRuntimeServer({
    port: args.port,
    bind: args.bind,
    token,
    workspace,
    origins: args.origins,
    executor:
      options?.executor ??
      createAgentRuntimeExecutor({
        ...(agentRegistry ? { agentRegistry } : {}),
      }),
    profile: args.profile ?? "trusted",
  });

  const url = `ws://${args.bind}:${server.port}`;
  const print = options?.print ?? console.log;
  print(`lapis-ai-host listening on ${url}`);
  print(`token: ${token}`);

  return {
    token,
    url,
    workspace,
    generatedToken,
    disconnectClients: () => server.disconnectClients(),
    close: () => server.close(),
  };
}
