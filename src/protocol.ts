export type NativeAgentProcessMessage = {
  processId: string;
  type: "stdout" | "stderr" | "exit";
  data?: string;
  exitCode?: number;
};

export type NativeAgentRuntimeEventPayload = {
  type: "event" | "permission" | "closed";
  event?: Record<string, unknown>;
  request?: Record<string, unknown>;
};

export type UnsequencedAgentRuntimeEvent = NativeAgentRuntimeEventPayload & {
  sessionId: string;
};

export type NativeAgentRuntimeEvent = {
  sessionId: string;
  runId: string;
  sequence: number;
  event: NativeAgentRuntimeEventPayload;
};

export const AGENT_RUNTIME_PROTOCOL = 4;
export const MIN_AGENT_RUNTIME_PROTOCOL = 2;
export const HELLO_TIMEOUT_MS = 5_000;
export const AUTH_CLOSE_CODE = 4401;
export const REPLAY_MAX_FRAMES = 10_000;
export const REPLAY_MAX_BYTES = 8 * 1024 * 1024;

export const AGENT_RUNTIME_COMMANDS = [
  "desktop_agent_acp_start",
  "desktop_agent_acp_models",
  "desktop_agent_acp_prompt",
  "desktop_agent_acp_configure",
  "desktop_agent_runtime_subscribe",
  "desktop_agent_acp_cancel",
  "desktop_agent_acp_close",
  "desktop_agent_acp_respond",
  "desktop_agent_tools_open",
  "desktop_agent_tools_respond",
  "desktop_agent_tools_close",
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
  protocol: number;
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

export type RuntimeReplayCursor = {
  sessionId: string;
  afterSequence: number;
};

export type RuntimeReplaySubscription = {
  sessionId: string;
  replayed: number;
  latestSequence: number;
  gap: boolean;
};

export type ProcessMessageFrame = {
  type: "agent-process-message";
  event: NativeAgentProcessMessage;
};

export type ToolCallFrame = {
  type: "desktop_agent_tool_call";
  event: import("./tool-bridge").ToolBridgeCall;
};

export type ToolCancelFrame = {
  type: "desktop_agent_tool_cancel";
  event: import("./tool-bridge").ToolBridgeCancel;
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
