import type { WebSocket } from "ws";
import type { AgentHostSink } from "../executor/executor";
import {
  AGENT_RUNTIME_PROTOCOL,
  AUTH_CLOSE_CODE,
  isCommandRequest,
  isHelloRequest,
} from "../protocol/protocol";
import { tokensEqual } from "./token";
import { replayCursors, RuntimeEventBroker, sendJson } from "./ws-broker";
import { dispatchCommand } from "./ws-commands";
import { CONTROLLER_COMMANDS, type AgentRuntimeServerOptions } from "./ws-types";

export function bindAuthenticatedSocket(
  socket: WebSocket,
  options: AgentRuntimeServerOptions,
  handshakeTimeoutMs: number,
  broker: RuntimeEventBroker,
  connectionId: string,
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
      connectionId,
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
    options.executor.disconnectConnection(connectionId);
  });
}

export async function handleMessage(
  raw: string,
  socket: WebSocket,
  options: AgentRuntimeServerOptions,
  broker: RuntimeEventBroker,
  connectionId: string,
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
  if (
    options.profile === "controller" &&
    !CONTROLLER_COMMANDS.has(parsed.command)
  ) {
    sendJson(socket, {
      id: parsed.id,
      error: {
        message: `Command unavailable in controller profile: ${parsed.command}`,
      },
    });
    return;
  }
  const sink: AgentHostSink = {
    connectionId,
    sendRuntimeEvent(event) {
      broker.publish(event);
    },
    sendProcessMessage(event) {
      sendJson(socket, { type: "agent-process-message", event });
    },
    sendToolCall(event) {
      sendJson(socket, { type: "desktop_agent_tool_call", event });
    },
    sendToolCancel(event) {
      sendJson(socket, { type: "desktop_agent_tool_cancel", event });
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

function closeAuth(socket: WebSocket, reason: string): void {
  socket.close(AUTH_CLOSE_CODE, reason);
}
