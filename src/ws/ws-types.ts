import type { AgentRuntimeExecutor } from "../executor/executor";

export type AgentRuntimeServerOptions = {
  port: number;
  bind: string;
  token: string;
  workspace: string;
  origins?: string[];
  executor: AgentRuntimeExecutor;
  handshakeTimeoutMs?: number;
  profile?: "trusted" | "controller";
};

export type AgentRuntimeServer = {
  port: number;
  disconnectClients(): void;
  close(): Promise<void>;
};

export const CONTROLLER_COMMANDS = new Set([
  "desktop_agent_acp_agents",
  "desktop_agent_acp_models",
  "desktop_agent_acp_start",
  "desktop_agent_acp_prompt",
  "desktop_agent_acp_configure",
  "desktop_agent_acp_status",
  "desktop_agent_runtime_subscribe",
  "desktop_agent_acp_cancel",
  "desktop_agent_acp_close",
  "desktop_agent_acp_respond",
  "desktop_agent_tools_open",
  "desktop_agent_tools_respond",
  "desktop_agent_tools_close",
]);
