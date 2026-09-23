import type {
  NativeAgentProcessMessage,
  NativeAgentRuntimeEvent,
} from "../protocol/protocol";
import type { ToolBridgeCall, ToolBridgeCancel } from "../mcp/tool-bridge";

export type AgentRuntimeAttachConfig = {
  url: string;
  token: string;
  manualAcknowledgement?: boolean;
  replayCursors?: Array<{ sessionId: string; afterSequence: number }>;
};

export type AgentRuntimeBridge = {
  readonly runtime: "deno-desktop";
  readonly capabilities: {
    "agent-runtime": {
      id: "agent-runtime";
      status: "available";
      provider: string;
      details: Record<string, string>;
    };
  };
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  acknowledgeAgentRuntimeEvent(sessionId: string, sequence: number): void;
  dispose(): void;
  toFileUrl(path: string): string;
  onAgentRuntimeEvent?(
    listener: (event: NativeAgentRuntimeEvent) => void,
  ): () => void;
  onAgentProcessMessage?(
    listener: (event: NativeAgentProcessMessage) => void,
  ): () => void;
  onAgentToolCall?(listener: (event: ToolBridgeCall) => void): () => void;
  onAgentToolCancel?(listener: (event: ToolBridgeCancel) => void): () => void;
};

export type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export type ClientRuntimeState = {
  options: AgentRuntimeAttachConfig;
  pending: Map<string, Pending>;
  runtimeListeners: Set<(event: NativeAgentRuntimeEvent) => void>;
  processListeners: Set<(event: NativeAgentProcessMessage) => void>;
  toolCallListeners: Set<(event: ToolBridgeCall) => void>;
  toolCancelListeners: Set<(event: ToolBridgeCancel) => void>;
  activeToolCalls: Map<string, ToolBridgeCall>;
  activeToolBridges: Set<string>;
  activeSessions: Map<string, number>;
  receivedSessions: Map<string, number>;
  replayGapSequences: Map<string, number>;
  agentRuntimeCapability: {
    id: "agent-runtime";
    status: "available";
    provider: string;
    details: Record<string, string>;
  };
  nextId: number;
  negotiatedProtocol: number;
  disposed: boolean;
  socket: WebSocket | null;
  connectPromise: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

export function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function readEnv(name: string): string {
  const meta = (import.meta as { env?: Record<string, string | undefined> })
    .env;
  const fromMeta = trim(meta?.[name]);
  if (fromMeta) return fromMeta;
  if (typeof process !== "undefined") {
    const fromProcess = trim(process.env?.[name]);
    if (fromProcess) return fromProcess;
  }
  const globalConfig = (
    globalThis as {
      __LAPIS_AGENT_RUNTIME__?: Partial<AgentRuntimeAttachConfig>;
    }
  ).__LAPIS_AGENT_RUNTIME__;
  if (name === "LAPIS_AGENT_RUNTIME_URL") return trim(globalConfig?.url);
  if (name === "LAPIS_AGENT_RUNTIME_TOKEN") return trim(globalConfig?.token);
  return "";
}

export function resolveAgentRuntimeAttachConfig(
  options?: Partial<AgentRuntimeAttachConfig>,
): AgentRuntimeAttachConfig | null {
  const url = trim(options?.url) || readEnv("LAPIS_AGENT_RUNTIME_URL");
  const token = trim(options?.token) || readEnv("LAPIS_AGENT_RUNTIME_TOKEN");
  if (!url || !token) return null;
  return { url, token };
}

export function toolCallKey(
  event: Pick<ToolBridgeCall, "bridgeId" | "callId">,
): string {
  return `${event.bridgeId}:${event.callId}`;
}

export function nextMessageId(state: ClientRuntimeState): string {
  state.nextId += 1;
  return `ai-host-${state.nextId}`;
}
