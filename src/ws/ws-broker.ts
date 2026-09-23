import type { WebSocket } from "ws";
import type {
  NativeAgentRuntimeEvent,
  RuntimeReplayCursor,
} from "../protocol/protocol";
import { RuntimeEventReplayBuffer } from "../protocol/replay-buffer";

export function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

export class RuntimeEventBroker {
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

export function replayCursors(
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
