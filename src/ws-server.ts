import { WebSocketServer, type WebSocket } from "ws";
import type { AgentHostSink, AgentRuntimeExecutor } from "./executor";
import {
  AGENT_RUNTIME_PROTOCOL,
  AUTH_CLOSE_CODE,
  HELLO_TIMEOUT_MS,
  isCommandRequest,
  isHelloRequest,
  type NativeAgentRuntimeEvent,
  type RuntimeReplayCursor,
} from "./protocol";
import { RuntimeEventReplayBuffer } from "./replay-buffer";
import { tokensEqual } from "./token";

export type AgentRuntimeServerOptions = {
  port: number;
  bind: string;
  token: string;
  workspace: string;
  origins?: string[];
  executor: AgentRuntimeExecutor;
  handshakeTimeoutMs?: number;
};

export type AgentRuntimeServer = {
  port: number;
  disconnectClients(): void;
  close(): Promise<void>;
};

export async function startAgentRuntimeServer(
  options: AgentRuntimeServerOptions,
): Promise<AgentRuntimeServer> {
  const origins = options.origins ?? [];
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HELLO_TIMEOUT_MS;
  const server = new WebSocketServer({
    host: options.bind,
    port: options.port,
    verifyClient: (info: { origin: string }) => {
      if (origins.length === 0) return true;
      return origins.includes(info.origin);
    },
  });
  const broker = new RuntimeEventBroker();

  server.on("connection", (socket) => {
    bindAuthenticatedSocket(socket, options, handshakeTimeoutMs, broker);
  });

  await waitForListening(server);

  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : options.port;

  return {
    port,
    disconnectClients() {
      for (const client of server.clients) {
        client.close(1012, "agent-runtime transport restart");
      }
    },
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of server.clients) {
          client.terminate();
        }
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function bindAuthenticatedSocket(
  socket: WebSocket,
  options: AgentRuntimeServerOptions,
  handshakeTimeoutMs: number,
  broker: RuntimeEventBroker,
): void {
  let authenticated = false;
  const timeout = setTimeout(() => {
    if (!authenticated) closeAuth(socket, "handshake timeout");
  }, handshakeTimeoutMs);

  socket.on("message", (raw) => {
    void handleMessage(
      raw.toString(),
      socket,
      options,
      broker,
      (ok) => {
        authenticated = ok;
        if (ok) clearTimeout(timeout);
      },
      () => authenticated,
    );
  });

  socket.on("close", () => {
    clearTimeout(timeout);
    broker.disconnect(socket);
  });
}

async function handleMessage(
  raw: string,
  socket: WebSocket,
  options: AgentRuntimeServerOptions,
  broker: RuntimeEventBroker,
  setAuthenticated: (ok: boolean) => void,
  isAuthenticated: () => boolean,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (!isAuthenticated()) {
      closeAuth(socket, "invalid handshake");
      return;
    }
    return;
  }

  if (!isAuthenticated()) {
    if (!isHelloRequest(parsed) || !tokensEqual(options.token, parsed.token)) {
      closeAuth(socket, "authentication failed");
      return;
    }
    setAuthenticated(true);
    sendJson(socket, {
      id: parsed.id,
      type: "hello.ok",
      protocol: AGENT_RUNTIME_PROTOCOL,
    });
    return;
  }

  if (!isCommandRequest(parsed)) return;
  const sink: AgentHostSink = {
    sendRuntimeEvent(event) {
      broker.publish(event);
    },
    sendProcessMessage(event) {
      sendJson(socket, { type: "agent-process-message", event });
    },
  };

  try {
    if (parsed.command === "desktop_agent_runtime_subscribe") {
      const result = broker.subscribe(socket, replayCursors(parsed.payload));
      sendJson(socket, { id: parsed.id, result });
      return;
    }
    if (parsed.command === "desktop_agent_acp_prompt") {
      broker.follow(socket, String(parsed.payload?.sessionId ?? ""));
    }
    const result = await dispatchCommand(
      options,
      sink,
      parsed.command,
      parsed.payload ?? {},
    );
    if (parsed.command === "desktop_agent_acp_start") {
      broker.follow(
        socket,
        String((result as { sessionId?: unknown })?.sessionId ?? ""),
      );
    }
    if (parsed.command === "desktop_agent_acp_close") {
      broker.clear(String(parsed.payload?.sessionId ?? ""));
    }
    sendJson(socket, { id: parsed.id, result });
  } catch (error) {
    sendJson(socket, {
      id: parsed.id,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function dispatchCommand(
  options: AgentRuntimeServerOptions,
  sink: AgentHostSink,
  command: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const executor = options.executor;
  switch (command) {
    case "desktop_agent_acp_models":
      return executor.listAcpModels(sink, {
        workspace: options.workspace,
        agent: String(payload.agent ?? ""),
      });
    case "desktop_agent_acp_start":
      return executor.startAcpSession(sink, {
        ...payload,
        workspace: options.workspace,
      });
    case "desktop_agent_acp_prompt":
      return executor.promptAcpSession(
        sink,
        String(payload.sessionId ?? ""),
        String(payload.text ?? ""),
      );
    case "desktop_agent_acp_cancel":
      await executor.cancelAcpSession(String(payload.sessionId ?? ""));
      return null;
    case "desktop_agent_acp_close":
      await executor.closeAcpSession(String(payload.sessionId ?? ""));
      return null;
    case "desktop_agent_acp_respond":
      executor.respondAcpSession(
        String(payload.sessionId ?? ""),
        String(payload.requestId ?? ""),
        (payload.decision as string) ?? "",
      );
      return null;
    case "desktop_agent_process_spawn":
      return executor.spawnProcess(sink, {
        ...payload,
        cwd: options.workspace,
      });
    case "desktop_agent_process_write":
      executor.writeProcess(
        String(payload.processId ?? ""),
        String(payload.data ?? ""),
      );
      return null;
    case "desktop_agent_process_kill":
      executor.killProcess(String(payload.processId ?? ""));
      return null;
    default:
      throw new Error(`Unknown agent-runtime command: ${command}`);
  }
}

class RuntimeEventBroker {
  readonly #replay = new RuntimeEventReplayBuffer();
  readonly #subscribers = new Map<string, Set<WebSocket>>();

  publish(event: NativeAgentRuntimeEvent): void {
    this.#replay.append(event);
    for (const socket of this.#subscribers.get(event.sessionId) ?? []) {
      sendJson(socket, { type: "agent-runtime-event", event });
    }
  }

  follow(socket: WebSocket, sessionId: string): void {
    if (!sessionId) return;
    const subscribers =
      this.#subscribers.get(sessionId) ?? new Set<WebSocket>();
    subscribers.add(socket);
    this.#subscribers.set(sessionId, subscribers);
  }

  subscribe(socket: WebSocket, cursors: RuntimeReplayCursor[]) {
    for (const cursor of cursors) this.follow(socket, cursor.sessionId);
    return this.#replay.replay(cursors, (event) => {
      sendJson(socket, { type: "agent-runtime-event", event });
    });
  }

  clear(sessionId: string): void {
    this.#replay.clear(sessionId);
    this.#subscribers.delete(sessionId);
  }

  disconnect(socket: WebSocket): void {
    for (const [sessionId, subscribers] of this.#subscribers) {
      subscribers.delete(socket);
      if (subscribers.size === 0) this.#subscribers.delete(sessionId);
    }
  }
}

function replayCursors(
  payload: Record<string, unknown> | undefined,
): RuntimeReplayCursor[] {
  if (!Array.isArray(payload?.sessions)) return [];
  return payload.sessions.flatMap((value): RuntimeReplayCursor[] => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const sessionId =
      typeof record.sessionId === "string" ? record.sessionId : "";
    const afterSequence = Number(record.afterSequence);
    if (
      !sessionId ||
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < 0
    ) {
      return [];
    }
    return [{ sessionId, afterSequence }];
  });
}

function closeAuth(socket: WebSocket, reason: string): void {
  socket.close(AUTH_CLOSE_CODE, reason);
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

function waitForListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
}
