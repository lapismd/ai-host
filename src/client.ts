import {
  AGENT_RUNTIME_PROTOCOL,
  isHelloRequest,
  type CommandResult,
  type HelloOk,
  type NativeAgentProcessMessage,
  type NativeAgentRuntimeEvent,
  type ProcessMessageFrame,
  type RuntimeEventFrame,
} from "./protocol";

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
  toFileUrl(path: string): string;
  onAgentRuntimeEvent?(
    listener: (event: NativeAgentRuntimeEvent) => void,
  ): () => void;
  onAgentProcessMessage?(
    listener: (event: NativeAgentProcessMessage) => void,
  ): () => void;
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
  const activeSessions = new Set<string>();
  let nextId = 0;

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
      for (const listener of runtimeListeners) listener(frame.event);
      return;
    }
    if (record.type === "agent-process-message") {
      const frame = parsed as ProcessMessageFrame;
      for (const listener of processListeners) listener(frame.event);
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

  async function ensureConnected(): Promise<void> {
    if (socket?.readyState === WebSocket.OPEN && connectPromise) {
      await connectPromise;
      return;
    }
    connectPromise = new Promise<void>((resolve, reject) => {
      const next = new WebSocket(options.url);
      socket = next;
      const helloId = nextMessageId();
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        next.close();
        reject(error);
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
          (parsed as HelloOk).protocol === AGENT_RUNTIME_PROTOCOL
        ) {
          next.removeEventListener("message", onHandshake);
          next.addEventListener("message", (later) => {
            handleFrame(String(later.data));
          });
          settled = true;
          clearTimeout(timer);
          resolve();
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
        if (!settled && event.code >= 4000) {
          fail(
            new Error(event.reason || "Agent-runtime authentication failed"),
          );
          return;
        }
        if (!settled) return;
        const message = event.reason || "Agent-runtime connection closed";
        const error = new Error(message);
        for (const [id, waiter] of pending) {
          pending.delete(id);
          waiter.reject(error);
        }
        for (const sessionId of activeSessions) {
          for (const listener of runtimeListeners) {
            listener({
              sessionId,
              type: "closed",
              event: { type: "error", message },
            });
          }
        }
        activeSessions.clear();
        if (socket === next) socket = null;
        connectPromise = null;
      });
    });
    await connectPromise;
  }

  async function invoke<T>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    await ensureConnected();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Agent-runtime socket is not open");
    }
    const id = nextMessageId();
    const result = await new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket!.send(JSON.stringify({ id, command, payload }));
    });
    const sessionId =
      result && typeof result === "object" && "sessionId" in result
        ? String((result as { sessionId?: unknown }).sessionId ?? "")
        : "";
    if (command === "desktop_agent_acp_start" && sessionId) {
      activeSessions.add(sessionId);
    }
    if (command === "desktop_agent_acp_close") {
      activeSessions.delete(String(payload?.sessionId ?? ""));
    }
    return result as T;
  }

  return {
    runtime: "electron-desktop",
    capabilities: {
      "agent-runtime": {
        id: "agent-runtime",
        status: "available",
        provider: "lapis-ai-host",
        details: {
          protocol: "desktop_agent_*",
          transport: "websocket",
        },
      },
    },
    invoke,
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
