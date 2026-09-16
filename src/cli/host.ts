import { readFile } from "node:fs/promises";
import {
  createAcpAgentRegistry,
  DEFAULT_ACP_AGENTS,
  parseAcpAgentDefinitions,
} from "../acp-agent";
import { createAgentRuntimeExecutor } from "../executor";
import { serveAgentHost } from "../serve";
import { executable } from "./config";
import { currentSelfInvocation } from "./self";
import { CliError, type HostConfig, type Host, type HostEvent } from "./types";
async function definitions(config: HostConfig) {
  try {
    const entries = config.agentConfig
      ? parseAcpAgentDefinitions(
          JSON.parse(await readFile(config.agentConfig, "utf8")),
        )
      : DEFAULT_ACP_AGENTS;
    return createAcpAgentRegistry(
      entries.map((entry) => ({
        ...entry,
        command:
          entry.command ??
          (entry.id === "codex"
            ? ["codex-acp"]
            : entry.id === "cursor"
              ? ["cursor-agent", "acp"]
              : [entry.id]),
      })),
    ).list();
  } catch {
    throw new CliError(
      "invalid_config",
      "Invalid ACP agent registry; check --agent-config",
    );
  }
}
function firstCommand(command: string | string[] | undefined): string {
  return Array.isArray(command)
    ? (command[0] ?? "")
    : (command
        ?.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/)
        ?.slice(1)
        .find(Boolean) ?? "");
}
export async function runtimes(config: HostConfig) {
  const registry = createAcpAgentRegistry(await definitions(config));
  return await Promise.all(
    registry.list().map(async (a) => ({
      id: a.id,
      label: a.label,
      mcpTransport: a.mcpTransport,
      available: !!(await executable(firstCommand(a.command))),
    })),
  );
}
export async function prerequisite(config: HostConfig) {
  return await runtimes(config);
}
export async function startHost(
  config: HostConfig,
  token: string,
  onEvent: (event: HostEvent) => void,
): Promise<Host> {
  const entries = await definitions(config);
  for (const entry of entries) {
    const command = entry.command ?? [entry.id];
    const first = firstCommand(command);
    const resolved = (await executable(first)) ?? first;
    // An explicitly quoted command bypasses acpx's built-in Node launcher inference.
    // The external executable (including its shebang) owns its interpreter.
    entry.command = Array.isArray(command)
      ? [resolved, ...command.slice(1)]
          .map((part) => JSON.stringify(part))
          .join(" ")
      : command.replace(/^(?:"[^"]+"|'[^']+'|\S+)/, () =>
          JSON.stringify(resolved),
        );
  }
  const invocation = currentSelfInvocation();
  const executor = createAgentRuntimeExecutor({
    agentRegistry: createAcpAgentRegistry(entries),
    toolBridgeOptions: {
      shimCommand: {
        command: invocation.command,
        args: [...invocation.argsPrefix, "__internal", "mcp-shim"],
      },
    },
  });
  const host = await serveAgentHost(
    { ...config, token },
    { executor, print: () => {}, printToken: false, onEvent },
  );
  return {
    ...host,
    inspect: () =>
      host.inspect().map((s) => ({
        sessionId: s.sessionId,
        state: s.state,
        runId: s.runId ?? null,
        latestSequence: s.latestSequence,
        pendingPermissions: s.pendingPermissions.length,
      })),
  };
}
