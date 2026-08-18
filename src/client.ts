import {
  AGENT_RUNTIME_PROTOCOL,
  MIN_AGENT_RUNTIME_PROTOCOL,
  isHelloRequest,
  type CommandResult,
  type HelloOk,
  type NativeAgentProcessMessage,
  type NativeAgentRuntimeEvent,
  type ProcessMessageFrame,
  type RuntimeReplaySubscription,
  type RuntimeEventFrame,
  type ToolCallFrame,
  type ToolCancelFrame,
} from "./protocol";
import type { ToolBridgeCall, ToolBridgeCancel } from "./tool-bridge";

export type AgentRuntimeAttachConfig = {
  url: string;
  token: string;
};

export type AgentRuntimeBridge = {
  readonly runtime: "electron-desktop";
  readonly capabilities: {
    "agent-runtime": {
      id: "agent-runtime";
      status: "available";
      provider: string;
      details: Record<string, string>;
    };
  };
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
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

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function readEnv(name: string): string {
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

export function createAgentRuntimeBridge(
  options: AgentRuntimeAttachConfig,
): AgentRuntimeBridge {
  let socket: WebSocket | null = null;
  let connectPromise: Promise<void> | null = null;
  const pending = new Map<string, Pending>();
  const runtimeListeners = new Set<(event: NativeAgentRuntimeEvent) => void>();
  const processListeners = new Set<
    (event: NativeAgentProcessMessage) => void
  >();
  const toolCallListeners = new Set<(event: ToolBridgeCall) => void>();
  const toolCancelListeners = new Set<(event: ToolBridgeCancel) => void>();
  const activeToolCalls = new Map<string, ToolBridgeCall>();
  const activeToolBridges = new Set<string>();
  const activeSessions = new Map<string, number>();
  const replayGapSequences = new Map<string, number>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let nextId = 0;
  let negotiatedProtocol = AGENT_RUNTIME_PROTOCOL;
  const agentRuntimeCapability = {
    id: "agent-runtime" as const,
    status: "available" as const,
    provider: "lapis-ai-host",
    details: {
      protocol: "desktop_agent_*",
      protocolVersion: String(AGENT_RUNTIME_PROTOCOL),
      transport: "websocket",
      appTools: "stdio-mcp",
    },
  };

  function nextMessageId(): string {
    nextId += 1;
    return `ai-host-${nextId}`;
  }

  function handleFrame(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const record = parsed as Record<string, unknown>;
    if (record.type === "agent-runtime-event") {
      const frame = parsed as RuntimeEventFrame;
      const previous = activeSessions.get(frame.event.sessionId);
      if (previous != null && frame.event.sequence <= previous) return;
      if (previous != null && frame.event.sequence > previous + 1) {
        activeSessions.set(frame.event.sessionId, frame.event.sequence);
        notifyReplayGap(frame.event.sessionId, previous, frame.event.sequence);
        return;
      }
      activeSessions.set(frame.event.sessionId, frame.event.sequence);
      for (const listener of runtimeListeners) listener(frame.event);
      return;
    }
    if (record.type === "agent-process-message") {
      const frame = parsed as ProcessMessageFrame;
      for (const listener of processListeners) listener(frame.event);
      return;
    }
    if (record.type === "desktop_agent_tool_call") {
      const frame = parsed as ToolCallFrame;
      activeToolCalls.set(toolCallKey(frame.event), frame.event);
      for (const listener of toolCallListeners) listener(frame.event);
      return;
    }
    if (record.type === "desktop_agent_tool_cancel") {
      const frame = parsed as ToolCancelFrame;
      activeToolCalls.delete(toolCallKey(frame.event));
      for (const listener of toolCancelListeners) listener(frame.event);
      return;
    }
    if (typeof record.id === "string") {
      const waiter = pending.get(record.id);
      if (!waiter) return;
      pending.delete(record.id);
      const result = parsed as CommandResult & Partial<HelloOk>;
      if (result.error) {
        waiter.reject(new Error(result.error.message));
        return;
      }
      waiter.resolve(result.result ?? result);
    }
  }

  function notifyReplayGap(
    sessionId: string,
    afterSequence: number,
    receivedSequence: number,
  ): void {
    if ((replayGapSequences.get(sessionId) ?? -1) >= receivedSequence) return;
    replayGapSequences.set(sessionId, receivedSequence);
    const message =
      `Agent-runtime replay gap after sequence ${afterSequence}; ` +
      "the interrupted turn was not resent because it may have caused side effects.";
    const event: NativeAgentRuntimeEvent = {
      sessionId,
      runId: "replay-gap",
      sequence: receivedSequence,
      event: {
        type: "closed",
        event: {
          type: "error",
          code: "AGENT_RUNTIME_REPLAY_GAP",
          message,
        },
      },
    };
    for (const listener of runtimeListeners) listener(event);
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer || activeSessions.size === 0) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected().catch(() => scheduleReconnect());
    }, 250);
  }

  function cancelDisconnectedToolCalls(): void {
    for (const call of activeToolCalls.values()) {
      const cancel: ToolBridgeCancel = {
        bridgeId: call.bridgeId,
        bindingId: call.bindingId,
        callId: call.callId,
      };
      for (const listener of toolCancelListeners) listener(cancel);
    }
    activeToolCalls.clear();
    if (activeToolBridges.size === 0) return;
    for (const [sessionId, previous] of activeSessions) {
      const sequence = previous + 1;
      activeSessions.set(sessionId, sequence);
      for (const listener of runtimeListeners) {
        listener({
          sessionId,
          runId: "app-tool-bridge-disconnect",
          sequence,
          event: {
            type: "closed",
            event: {
              type: "error",
              code: "AGENT_TOOL_BRIDGE_DISCONNECTED",
              message:
                "Application-tool authorization was revoked when the agent host disconnected. Retry to create a new binding.",
            },
          },
        });
      }
    }
    activeToolBridges.clear();
  }

  async function ensureConnected(): Promise<void> {
    if (disposed) throw new Error("Agent-runtime bridge is disposed");
    if (socket?.readyState === WebSocket.OPEN) {
      if (connectPromise) await connectPromise;
      return;
    }
    if (!connectPromise) {
      connectPromise = new Promise<void>((resolve, reject) => {
        const next = new WebSocket(options.url);
      socket = next;
      const helloId = nextMessageId();
      let finished = false;
      let ready = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        next.close();
        if (socket === next) socket = null;
        connectPromise = null;
        reject(error);
        scheduleReconnect();
      };
      const timer = setTimeout(() => {
        fail(new Error(`Agent-runtime connection timed out: ${options.url}`));
      }, 5_000);
      const onHandshake = (event: MessageEvent) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          fail(new Error("Invalid agent-runtime handshake"));
          return;
        }
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as HelloOk).type === "hello.ok" &&
          (parsed as HelloOk).id === helloId &&
          Number.isInteger((parsed as HelloOk).protocol) &&
          (parsed as HelloOk).protocol >= MIN_AGENT_RUNTIME_PROTOCOL &&
          (parsed as HelloOk).protocol <= AGENT_RUNTIME_PROTOCOL
        ) {
          negotiatedProtocol = (parsed as HelloOk).protocol;
          agentRuntimeCapability.details.protocolVersion = String(
            negotiatedProtocol,
          );
          agentRuntimeCapability.details.appTools =
            negotiatedProtocol >= 3 ? "stdio-mcp" : "unavailable";
          next.removeEventListener("message", onHandshake);
          next.addEventListener("message", (later) => {
            handleFrame(String(later.data));
          });
          const cursors = [...activeSessions].map(
            ([sessionId, afterSequence]) => ({ sessionId, afterSequence }),
          );
          const finish = () => {
            if (finished) return;
            finished = true;
            ready = true;
            clearTimeout(timer);
            resolve();
          };
          if (cursors.length === 0) {
            finish();
            return;
          }
          const id = nextMessageId();
          const subscribed = new Promise<RuntimeReplaySubscription[]>(
            (resolveSubscribe, rejectSubscribe) => {
              pending.set(id, {
                resolve: (value) =>
                  resolveSubscribe(value as RuntimeReplaySubscription[]),
                reject: rejectSubscribe,
              });
              next.send(
                JSON.stringify({
                  id,
                  command: "desktop_agent_runtime_subscribe",
                  payload: { sessions: cursors },
                }),
              );
            },
          );
          void subscribed.then((results) => {
            for (const result of results) {
              const previous = activeSessions.get(result.sessionId) ?? 0;
              if (result.gap) {
                const interruptedSequence = Math.max(
                  result.latestSequence,
                  previous + 1,
                );
                activeSessions.set(result.sessionId, interruptedSequence);
                notifyReplayGap(
                  result.sessionId,
                  previous,
                  interruptedSequence,
                );
              }
            }
            finish();
          }, fail);
          return;
        }
        if (isHelloRequest(parsed)) {
          fail(new Error("Unexpected hello from agent-runtime host"));
          return;
        }
        fail(new Error("Agent-runtime handshake failed"));
      };
      next.addEventListener("open", () => {
        next.send(
          JSON.stringify({ id: helloId, type: "hello", token: options.token }),
        );
      });
      next.addEventListener("message", onHandshake);
      next.addEventListener("error", () => {
        fail(new Error("Agent-runtime socket error"));
      });
      next.addEventListener("close", (event) => {
        if (!ready) {
          fail(
            new Error(
              event.reason ||
                (event.code >= 4000
                  ? "Agent-runtime authentication failed"
                  : "Agent-runtime connection closed"),
            ),
          );
          return;
        }
        const message = event.reason || "Agent-runtime connection closed";
        const error = new Error(message);
        for (const [id, waiter] of pending) {
          pending.delete(id);
          waiter.reject(error);
        }
        cancelDisconnectedToolCalls();
        if (socket === next) socket = null;
        connectPromise = null;
        scheduleReconnect();
      });
      });
    }
    await connectPromise;
    if (disposed) throw new Error("Agent-runtime bridge is disposed");
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Agent-runtime socket is not open");
    }
  }

  async function invoke<T>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    await ensureConnected();
    if (command.startsWith("desktop_agent_tools_") && negotiatedProtocol < 3) {
      throw new Error(
        "Application tools require an agent host with protocol v3 support.",
      );
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Agent-runtime socket is not open");
    }
    const id = nextMessageId();
    const result = await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket!.send(JSON.stringify({ id, command, payload }));
    });
    if (command === "desktop_agent_tools_open") {
      const bridgeId = String(
        (result as { bridgeId?: unknown } | null)?.bridgeId ?? "",
      );
      if (bridgeId) activeToolBridges.add(bridgeId);
    }
    if (command === "desktop_agent_tools_respond") {
      activeToolCalls.delete(
        `${String(payload?.bridgeId ?? "")}:${String(payload?.callId ?? "")}`,
      );
    }
    if (command === "desktop_agent_tools_close") {
      const bridgeId = String(payload?.bridgeId ?? "");
      activeToolBridges.delete(bridgeId);
      for (const [key, call] of activeToolCalls) {
        if (call.bridgeId === bridgeId) activeToolCalls.delete(key);
      }
    }
    const sessionId =
      result && typeof result === "object" && "sessionId" in result
        ? String((result as { sessionId?: unknown }).sessionId ?? "")
        : "";
    if (command === "desktop_agent_acp_start" && sessionId) {
      if (!activeSessions.has(sessionId)) activeSessions.set(sessionId, 0);
    }
    if (command === "desktop_agent_acp_close") {
      const closedSessionId = String(payload?.sessionId ?? "");
      activeSessions.delete(closedSessionId);
      replayGapSequences.delete(closedSessionId);
      if (activeSessions.size === 0 && reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }
    return result as T;
  }

  return {
    runtime: "electron-desktop",
    capabilities: {
      "agent-runtime": agentRuntimeCapability,
    },
    invoke,
    dispose() {
      disposed = true;
      cancelDisconnectedToolCalls();
      activeSessions.clear();
      replayGapSequences.clear();
      toolCallListeners.clear();
      toolCancelListeners.clear();
      activeToolBridges.clear();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      const error = new Error("Agent-runtime bridge disposed");
      for (const [id, waiter] of pending) {
        pending.delete(id);
        waiter.reject(error);
      }
      socket?.close(1000, "agent-runtime bridge disposed");
      socket = null;
      connectPromise = null;
    },
    toFileUrl(path) {
      return path;
    },
    onAgentRuntimeEvent(listener) {
      runtimeListeners.add(listener);
      return () => {
        runtimeListeners.delete(listener);
      };
    },
    onAgentProcessMessage(listener) {
      processListeners.add(listener);
      return () => {
        processListeners.delete(listener);
      };
    },
    onAgentToolCall(listener) {
      toolCallListeners.add(listener);
      return () => toolCallListeners.delete(listener);
    },
    onAgentToolCancel(listener) {
      toolCancelListeners.add(listener);
      return () => toolCancelListeners.delete(listener);
    },
  };
}

function toolCallKey(
  event: Pick<ToolBridgeCall, "bridgeId" | "callId">,
): string {
  return `${event.bridgeId}:${event.callId}`;
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
