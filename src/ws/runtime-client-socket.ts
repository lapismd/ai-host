import {
  AGENT_RUNTIME_PROTOCOL,
  MIN_AGENT_RUNTIME_PROTOCOL,
  isHelloRequest,
  type HelloOk,
  type RuntimeReplaySubscription,
} from "../protocol/protocol";
import type { ToolBridgeCancel } from "../mcp/tool-bridge";
import { handleClientFrame, notifyReplayGap } from "./runtime-client-events";
import { nextMessageId, type ClientRuntimeState } from "./runtime-client-types";

export function scheduleReconnect(
  state: ClientRuntimeState,
  ensureConnected: () => Promise<void>,
): void {
  if (state.disposed || state.reconnectTimer || state.activeSessions.size === 0)
    return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void ensureConnected().catch(() =>
      scheduleReconnect(state, ensureConnected),
    );
  }, 250);
}

export function cancelDisconnectedToolCalls(state: ClientRuntimeState): void {
  for (const call of state.activeToolCalls.values()) {
    const cancel: ToolBridgeCancel = {
      bridgeId: call.bridgeId,
      bindingId: call.bindingId,
      callId: call.callId,
    };
    for (const listener of state.toolCancelListeners) listener(cancel);
  }
  state.activeToolCalls.clear();
  if (state.activeToolBridges.size === 0) return;
  for (const [sessionId, previous] of state.activeSessions) {
    const sequence = previous + 1;
    state.receivedSessions.set(sessionId, sequence);
    if (!state.options.manualAcknowledgement)
      state.activeSessions.set(sessionId, sequence);
    for (const listener of state.runtimeListeners) {
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
  state.activeToolBridges.clear();
}

export async function ensureClientConnected(
  state: ClientRuntimeState,
): Promise<void> {
  if (state.disposed) throw new Error("Agent-runtime bridge is disposed");
  if (state.socket?.readyState === WebSocket.OPEN) {
    if (state.connectPromise) await state.connectPromise;
    return;
  }
  if (!state.connectPromise) {
    state.connectPromise = openClientSocket(state);
  }
  await state.connectPromise;
  if (state.disposed) throw new Error("Agent-runtime bridge is disposed");
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    throw new Error("Agent-runtime socket is not open");
  }
}

function openClientSocket(state: ClientRuntimeState): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const next = new WebSocket(state.options.url);
    state.socket = next;
    const helloId = nextMessageId(state);
    let finished = false;
    let ready = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      next.close();
      if (state.socket === next) state.socket = null;
      state.connectPromise = null;
      reject(error);
      scheduleReconnect(state, () => ensureClientConnected(state));
    };
    const timer = setTimeout(() => {
      fail(
        new Error(
          `Agent-runtime connection timed out: ${state.options.url}`,
        ),
      );
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
        state.negotiatedProtocol = (parsed as HelloOk).protocol;
        state.agentRuntimeCapability.details.protocolVersion = String(
          state.negotiatedProtocol,
        );
        state.agentRuntimeCapability.details.appTools =
          state.negotiatedProtocol >= 3 ? "stdio-mcp" : "unavailable";
        state.agentRuntimeCapability.details.sessionConfiguration =
          state.negotiatedProtocol >= 4 ? "configure" : "unavailable";
        next.removeEventListener("message", onHandshake);
        next.addEventListener("message", (later) => {
          handleClientFrame(state, String(later.data));
        });
        const cursors = [...state.activeSessions].map(
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
        const id = nextMessageId(state);
        const subscribed = new Promise<RuntimeReplaySubscription[]>(
          (resolveSubscribe, rejectSubscribe) => {
            state.pending.set(id, {
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
            const previous = state.activeSessions.get(result.sessionId) ?? 0;
            if (result.gap) {
              const interruptedSequence = Math.max(
                result.latestSequence,
                previous + 1,
              );
              state.activeSessions.set(result.sessionId, interruptedSequence);
              state.receivedSessions.set(
                result.sessionId,
                interruptedSequence,
              );
              notifyReplayGap(
                state,
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
        JSON.stringify({
          id: helloId,
          type: "hello",
          token: state.options.token,
        }),
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
      for (const [id, waiter] of state.pending) {
        state.pending.delete(id);
        waiter.reject(error);
      }
      cancelDisconnectedToolCalls(state);
      if (state.socket === next) state.socket = null;
      state.connectPromise = null;
      scheduleReconnect(state, () => ensureClientConnected(state));
    });
  });
}
