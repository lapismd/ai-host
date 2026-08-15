export type NativeAgentProcessMessage = {
  processId: string;
  type: "stdout" | "stderr" | "exit";
  data?: string;
  exitCode?: number;
};

export type NativeAgentRuntimeEvent = {
  sessionId: string;
  type: "event" | "permission" | "closed";
  event?: Record<string, unknown>;
  request?: Record<string, unknown>;
};

export const AGENT_RUNTIME_PROTOCOL = 1;
export const HELLO_TIMEOUT_MS = 5_000;
export const AUTH_CLOSE_CODE = 4401;

export const AGENT_RUNTIME_COMMANDS = [
  "desktop_agent_acp_start",
  "desktop_agent_acp_prompt",
  "desktop_agent_acp_cancel",
  "desktop_agent_acp_close",
  "desktop_agent_acp_respond",
  "desktop_agent_process_spawn",
  "desktop_agent_process_write",
  "desktop_agent_process_kill",
] as const;

export type AgentRuntimeCommand = (typeof AGENT_RUNTIME_COMMANDS)[number];

export type HelloRequest = {
  id: string;
  type: "hello";
  token: string;
};

export type HelloOk = {
  id: string;
  type: "hello.ok";
  protocol: typeof AGENT_RUNTIME_PROTOCOL;
};

export type CommandRequest = {
  id: string;
  command: string;
  payload?: Record<string, unknown>;
};

export type CommandResult = {
  id: string;
  result?: unknown;
  error?: { message: string };
};

export type RuntimeEventFrame = {
  type: "agent-runtime-event";
  event: NativeAgentRuntimeEvent;
};

export type ProcessMessageFrame = {
  type: "agent-process-message";
  event: NativeAgentProcessMessage;
};

export function isHelloRequest(value: unknown): value is HelloRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "hello" &&
    typeof record.id === "string" &&
    typeof record.token === "string"
  );
}

export function isCommandRequest(value: unknown): value is CommandRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.command === "string";
}
