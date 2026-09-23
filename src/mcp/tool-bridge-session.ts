import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  parseRecord,
  sendJson,
  tokensEqual,
} from "./tool-bridge-framing";
import { toMcpToolResult } from "./tool-bridge-mcp";
import {
  MAX_CALL_BYTES,
  MAX_PENDING_CALLS,
  type BridgeRecord,
} from "./tool-bridge-types";

export function bindToolBridgeSocket(
  socket: WebSocket,
  bridges: Map<string, BridgeRecord>,
): void {
  let bridge: BridgeRecord | undefined;
  const helloTimer = setTimeout(() => {
    socket.close(4401, "tool bridge authentication timed out");
  }, 5_000);
  socket.once("message", (raw) => {
    clearTimeout(helloTimer);
    const hello = parseRecord(raw.toString(), MAX_CALL_BYTES);
    const candidate =
      hello?.type === "hello" && typeof hello.bridgeId === "string"
        ? bridges.get(hello.bridgeId)
        : undefined;
    if (
      !candidate ||
      typeof hello?.token !== "string" ||
      !tokensEqual(candidate.token, hello.token)
    ) {
      socket.close(4401, "tool bridge authentication failed");
      return;
    }
    bridge = candidate;
    bridge.sockets.add(socket);
    sendJson(socket, {
      type: "hello.ok",
      bridgeId: bridge.id,
      descriptors: bridge.descriptors,
    });
    socket.on("message", (later) =>
      handleBridgeMessage(bridge!, socket, later.toString()),
    );
  });
  socket.on("close", () => {
    clearTimeout(helloTimer);
    if (!bridge) return;
    bridge.sockets.delete(socket);
    for (const [callId, pending] of bridge.pending) {
      if (pending.kind !== "socket" || pending.socket !== socket) continue;
      bridge.pending.delete(callId);
      bridge.sink.sendToolCancel({
        bridgeId: bridge.id,
        bindingId: bridge.bindingId,
        callId,
      });
    }
  });
}

export function handleBridgeMessage(
  bridge: BridgeRecord,
  socket: WebSocket,
  raw: string,
): void {
  const message = parseRecord(raw, MAX_CALL_BYTES);
  if (!message) {
    socket.close(1009, "invalid tool bridge frame");
    return;
  }
  if (message.type === "cancel" && typeof message.id === "string") {
    const pending = bridge.pending.get(message.id);
    if (pending?.kind === "socket") {
      bridge.pending.delete(message.id);
      bridge.sink.sendToolCancel({
        bridgeId: bridge.id,
        bindingId: bridge.bindingId,
        callId: message.id,
      });
    }
    return;
  }
  if (
    message.type !== "call" ||
    typeof message.id !== "string" ||
    typeof message.name !== "string"
  ) {
    return;
  }
  if (
    bridge.pending.size >= MAX_PENDING_CALLS ||
    bridge.pending.has(message.id) ||
    !bridge.descriptors.some((descriptor) => descriptor.name === message.name)
  ) {
    sendJson(socket, {
      type: "result",
      id: message.id,
      error: { code: "tool_unavailable", message: "Tool call rejected" },
    });
    return;
  }
  bridge.pending.set(message.id, { kind: "socket", socket });
  bridge.sink.sendToolCall({
    bridgeId: bridge.id,
    bindingId: bridge.bindingId,
    callId: message.id,
    name: message.name,
    input: message.input,
  });
}

export async function invokeLocalTool(
  bridge: BridgeRecord,
  name: string,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw new Error("Tool call cancelled");
  if (
    bridge.pending.size >= MAX_PENDING_CALLS ||
    !bridge.descriptors.some((descriptor) => descriptor.name === name)
  ) {
    return {
      content: [{ type: "text", text: "Tool call rejected" }],
      isError: true,
    };
  }
  const callId = randomUUID();
  const settled = await new Promise<{
    result?: unknown;
    error?: { code: string; message: string };
  }>((resolve, reject) => {
    const onAbort = () => {
      if (!bridge.pending.delete(callId)) return;
      bridge.sink.sendToolCancel({
        bridgeId: bridge.id,
        bindingId: bridge.bindingId,
        callId,
      });
      reject(new Error("Tool call cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    bridge.pending.set(callId, {
      kind: "local",
      resolve(value) {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
    });
    bridge.sink.sendToolCall({
      bridgeId: bridge.id,
      bindingId: bridge.bindingId,
      callId,
      name,
      input,
    });
  });
  if (settled.error) {
    return {
      content: [{ type: "text", text: settled.error.message }],
      isError: true,
    };
  }
  return toMcpToolResult(settled.result);
}

export function closeBridgeRecord(
  bridges: Map<string, BridgeRecord>,
  bridge: BridgeRecord,
): void {
  bridges.delete(bridge.id);
  for (const [callId, pending] of bridge.pending) {
    if (pending.kind === "local") {
      pending.resolve({
        error: { code: "cancelled", message: "Tool bridge closed" },
      });
    }
    bridge.sink.sendToolCancel({
      bridgeId: bridge.id,
      bindingId: bridge.bindingId,
      callId,
    });
  }
  bridge.pending.clear();
  for (const socket of bridge.sockets) {
    socket.close(1000, "tool bridge closed");
  }
  bridge.sockets.clear();
}
