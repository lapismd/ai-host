import type { AcpAgentDefinition } from "../acp/acp-agent";
import { acpLaunchPolicy } from "../acp/acp-execution-policy";
import { withAcpEnvironment } from "../acp/acp-launch-environment";
import { vcsEnvironment } from "../acp/acp-session-options";
import type { AcpStartPayload } from "./types";

type Registry = { resolve?(agent: string): string | string[] };

export function acpRuntimeRegistry(
  createRegistry: (params?: {
    overrides?: Record<string, string | string[]>;
  }) => Registry,
  agent: AcpAgentDefinition,
  payload: AcpStartPayload,
): Registry {
  const configured = createRegistry(
    agent.command ? { overrides: { [agent.id]: agent.command } } : undefined,
  );
  if (!configured.resolve) return configured;
  const launch = acpLaunchPolicy(configured.resolve(agent.id), {
    agentId: agent.id,
    approvalPolicy: payload.approvalPolicy,
    permissionMode: payload.permissionMode,
    restricted: payload.restricted,
  });
  const environment = { ...vcsEnvironment(payload), ...launch.environment };
  const command = Object.keys(environment).length
    ? withAcpEnvironment(launch.command, environment)
    : launch.command;
  return createRegistry({ overrides: { [agent.id]: command } });
}
