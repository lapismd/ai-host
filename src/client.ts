import { AGENT_RUNTIME_PROTOCOL } from "./protocol/protocol";
import {
  cancelDisconnectedToolCalls,
  ensureClientConnected,
} from "./ws/runtime-client-socket";
import {
  resolveAgentRuntimeAttachConfig,
  type AgentRuntimeAttachConfig,
  type AgentRuntimeBridge,
  type ClientRuntimeState,
} from "./ws/runtime-client-types";

export type {
  AgentRuntimeAttachConfig,
  AgentRuntimeBridge,
} from "./ws/runtime-client-types";
export { resolveAgentRuntimeAttachConfig } from "./ws/runtime-client-types";

export function createAgentRuntimeBridge(
  options: AgentRuntimeAttachConfig,
): AgentRuntimeBridge {
  const state: ClientRuntimeState = {
    options,
    pending: new Map(),
    runtimeListeners: new Set(),
    processListeners: new Set(),
    toolCallListeners: new Set(),
    toolCancelListeners: new Set(),
    activeToolCalls: new Map(),
    activeToolBridges: new Set(),
    activeSessions: new Map(
      (options.replayCursors ?? []).map((cursor) => [
        cursor.sessionId,
        cursor.afterSequence,
      ]),
    ),
    receivedSessions: new Map(),
    replayGapSequences: new Map(),
    agentRuntimeCapability: {
      id: "agent-runtime",
      status: "available",
      provider: "lapis-ai-host",
      details: {
        protocol: "desktop_agent_*",
        protocolVersion: String(AGENT_RUNTIME_PROTOCOL),
        transport: "websocket",
        appTools: "stdio-mcp",
        sessionConfiguration: "configure",
      },
    },
    nextId: 0,
    negotiatedProtocol: AGENT_RUNTIME_PROTOCOL,
    disposed: false,
    socket: null,
    connectPromise: null,
    reconnectTimer: null,
  };
  state.receivedSessions = new Map(state.activeSessions);

  return {
    runtime: "deno-desktop",
    capabilities: {
      "agent-runtime": state.agentRuntimeCapability,
    },
    invoke: (command, payload) => invokeClientCommand(state, command, payload),
    acknowledgeAgentRuntimeEvent(sessionId, sequence) {
      if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error(
          "Agent-runtime acknowledgement requires a valid sequence",
        );
      }
      const received = state.receivedSessions.get(sessionId);
      if (received === undefined || sequence > received) {
        throw new Error(
          `Cannot acknowledge unreceived sequence for ${sessionId}`,
        );
      }
      const acknowledged = state.activeSessions.get(sessionId) ?? 0;
      if (sequence > acknowledged) state.activeSessions.set(sessionId, sequence);
    },
    dispose() {
      state.disposed = true;
      cancelDisconnectedToolCalls(state);
      state.activeSessions.clear();
      state.receivedSessions.clear();
      state.replayGapSequences.clear();
      state.toolCallListeners.clear();
      state.toolCancelListeners.clear();
      state.activeToolBridges.clear();
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      const error = new Error("Agent-runtime bridge disposed");
      for (const [id, waiter] of state.pending) {
        state.pending.delete(id);
        waiter.reject(error);
      }
      state.socket?.close(1000, "agent-runtime bridge disposed");
      state.socket = null;
      state.connectPromise = null;
    },
    toFileUrl(path) {
      return path;
    },
    onAgentRuntimeEvent(listener) {
      state.runtimeListeners.add(listener);
      return () => {
        state.runtimeListeners.delete(listener);
      };
    },
    onAgentProcessMessage(listener) {
      state.processListeners.add(listener);
      return () => {
        state.processListeners.delete(listener);
      };
    },
    onAgentToolCall(listener) {
      state.toolCallListeners.add(listener);
      return () => state.toolCallListeners.delete(listener);
    },
    onAgentToolCancel(listener) {
      state.toolCancelListeners.add(listener);
      return () => state.toolCancelListeners.delete(listener);
    },
  };
}

export function maybeRegisterAgentRuntimeBridge(
  options?: Partial<AgentRuntimeAttachConfig> & {
    hasBridge?(): boolean;
    register?(bridge: AgentRuntimeBridge): void;
  },
): boolean {
  if (options?.hasBridge?.()) return false;
  const config = resolveAgentRuntimeAttachConfig(options);
  if (!config) return false;
  if (!options?.register) return false;
  options.register(createAgentRuntimeBridge(config));
  return true;
}

async function invokeClientCommand<T>(
  state: ClientRuntimeState,
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  await ensureClientConnected(state);
  if (command.startsWith("desktop_agent_tools_") && state.negotiatedProtocol < 3) {
    throw new Error(
      "Application tools require an agent host with protocol v3 support.",
    );
  }
  if (command === "desktop_agent_acp_configure" && state.negotiatedProtocol < 4) {
    throw new Error(
      "Agent session configuration requires a host with protocol v4 support.",
    );
  }
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    throw new Error("Agent-runtime socket is not open");
  }
  const commandPayload = continuationPayload(state, command, payload);
  state.nextId += 1;
  const id = `ai-host-${state.nextId}`;
  const result = await new Promise<unknown>((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    state.socket!.send(JSON.stringify({ id, command, payload: commandPayload }));
  });
  if (command === "desktop_agent_tools_open") {
    const bridgeId = String(
      (result as { bridgeId?: unknown } | null)?.bridgeId ?? "",
    );
    if (bridgeId) state.activeToolBridges.add(bridgeId);
  }
  if (command === "desktop_agent_tools_respond") {
    state.activeToolCalls.delete(
      `${String(payload?.bridgeId ?? "")}:${String(payload?.callId ?? "")}`,
    );
  }
  if (command === "desktop_agent_tools_close") {
    const bridgeId = String(payload?.bridgeId ?? "");
    state.activeToolBridges.delete(bridgeId);
    for (const [key, call] of state.activeToolCalls) {
      if (call.bridgeId === bridgeId) state.activeToolCalls.delete(key);
    }
  }
  const sessionId =
    result && typeof result === "object" && "sessionId" in result
      ? String((result as { sessionId?: unknown }).sessionId ?? "")
      : "";
  if (command === "desktop_agent_acp_start" && sessionId) {
    if (!state.activeSessions.has(sessionId))
      state.activeSessions.set(sessionId, 0);
    if (!state.receivedSessions.has(sessionId))
      state.receivedSessions.set(sessionId, 0);
  }
  if (command === "desktop_agent_acp_close") {
    const closedSessionId = String(payload?.sessionId ?? "");
    state.activeSessions.delete(closedSessionId);
    state.receivedSessions.delete(closedSessionId);
    state.replayGapSequences.delete(closedSessionId);
    if (state.activeSessions.size === 0 && state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }
  return result as T;
}

function continuationPayload(
  state: ClientRuntimeState,
  command: string,
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (command !== "desktop_agent_acp_start") return payload;
  const sessionId = String(payload?.sessionId ?? "");
  const sequenceBase = state.activeSessions.get(sessionId);
  if (!sessionId || sequenceBase === undefined) return payload;
  return { ...payload, sequenceBase };
}
