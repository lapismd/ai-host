import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

const MAX_PENDING_CALLS = 128;
const MAX_CALL_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;

export type ToolBridgeDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  effect: "read" | "write" | "external";
};

export type ToolBridgeOpenPayload = {
  bindingId: string;
  conversationId: string;
  descriptors: ToolBridgeDescriptor[];
};

export type ToolBridgeCall = {
  bridgeId: string;
  bindingId: string;
  callId: string;
  name: string;
  input: unknown;
};

export type ToolBridgeCancel = Pick<
  ToolBridgeCall,
  "bridgeId" | "bindingId" | "callId"
>;

export type ToolBridgeResponse = {
  bridgeId: string;
  callId: string;
  result?: unknown;
  error?: { code: string; message: string };
};

export type ToolBridgeSink = {
  connectionId: string;
  sendToolCall(call: ToolBridgeCall): void;
  sendToolCancel(cancel: ToolBridgeCancel): void;
};

export type ToolBridgeServerContribution = {
  name: "lapis-tools";
  command: string;
  args: string[];
  env: Record<string, string>;
};

type BridgeRecord = {
  id: string;
  token: string;
  bindingId: string;
  conversationId: string;
  connectionId: string;
  descriptors: ToolBridgeDescriptor[];
  sink: ToolBridgeSink;
  sockets: Set<WebSocket>;
  pending: Map<string, WebSocket>;
};

export type ToolBridgeBrokerOptions = {
  shimPath?: string;
  nodeCommand?: string;
  shimArgsPrefix?: string[];
  extraEnv?: Record<string, string>;
};

export class ToolBridgeBroker {
  readonly #bridges = new Map<string, BridgeRecord>();
  readonly #shimPath: string;
  readonly #nodeCommand: string;
  readonly #shimArgsPrefix: string[];
  readonly #extraEnv: Record<string, string>;
  #server: WebSocketServer | null = null;
  #listeningPromise: Promise<void> | null = null;
  #port = 0;

  constructor(options: ToolBridgeBrokerOptions = {}) {
    this.#shimPath = options.shimPath ?? defaultShimPath();
    this.#nodeCommand = options.nodeCommand ?? process.execPath;
    this.#shimArgsPrefix = [...(options.shimArgsPrefix ?? [])];
    this.#extraEnv = { ...(options.extraEnv ?? {}) };
  }

  async open(
    sink: ToolBridgeSink,
    payload: ToolBridgeOpenPayload,
  ): Promise<{ bridgeId: string }> {
    await this.#ensureListening();
    if (!payload.bindingId || !payload.conversationId) {
      throw new Error("Tool bridge requires binding and conversation identity");
    }
    const bridgeId = randomUUID();
    this.#bridges.set(bridgeId, {
      id: bridgeId,
      token: randomBytes(32).toString("base64url"),
      bindingId: payload.bindingId,
      conversationId: payload.conversationId,
      connectionId: sink.connectionId,
      descriptors: sanitizeDescriptors(payload.descriptors),
      sink,
      sockets: new Set(),
      pending: new Map(),
    });
    return { bridgeId };
  }

  serverContribution(
    connectionId: string,
    bridgeId: string,
  ): ToolBridgeServerContribution {
    const bridge = this.#requireOwned(connectionId, bridgeId);
    return {
      name: "lapis-tools",
      command: this.#nodeCommand,
      args: [...this.#shimArgsPrefix, this.#shimPath],
      env: {
        ...this.#extraEnv,
        LAPIS_TOOL_BRIDGE_URL: `ws://127.0.0.1:${this.#port}`,
        LAPIS_TOOL_BRIDGE_ID: bridge.id,
        LAPIS_TOOL_BRIDGE_TOKEN: bridge.token,
      },
    };
  }

  respond(connectionId: string, response: ToolBridgeResponse): void {
    const bridge = this.#requireOwned(connectionId, response.bridgeId);
    const socket = bridge.pending.get(response.callId);
    if (!socket) throw new Error("Unknown or completed app tool call");
    bridge.pending.delete(response.callId);
    const frame = {
      type: "result",
      id: response.callId,
      result: response.result,
      error: response.error,
    };
    if (jsonBytes(frame) > MAX_RESULT_BYTES) {
      sendJson(socket, {
        type: "result",
        id: response.callId,
        error: { code: "result_too_large", message: "Tool result is too large" },
      });
      return;
    }
    sendJson(socket, frame);
  }

  closeBridge(connectionId: string, bridgeId: string): void {
    const bridge = this.#bridges.get(bridgeId);
    if (!bridge) return;
    if (bridge.connectionId !== connectionId) {
      throw new Error("Unknown app tool bridge");
    }
    this.#closeRecord(bridge);
  }

  closeConnection(connectionId: string): void {
    for (const bridge of [...this.#bridges.values()]) {
      if (bridge.connectionId === connectionId) this.#closeRecord(bridge);
    }
  }

  async close(): Promise<void> {
    for (const bridge of [...this.#bridges.values()]) this.#closeRecord(bridge);
    const server = this.#server;
    this.#server = null;
    this.#listeningPromise = null;
    this.#port = 0;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async #ensureListening(): Promise<void> {
    if (this.#listeningPromise) return this.#listeningPromise;
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.#server = server;
    server.on("connection", (socket) => this.#bindSocket(socket));
    this.#listeningPromise = new Promise<void>((resolve, reject) => {
      server.once("listening", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Tool bridge did not bind a loopback port"));
          return;
        }
        this.#port = address.port;
        resolve();
      });
      server.once("error", reject);
    });
    try {
      await this.#listeningPromise;
    } catch (error) {
      this.#server = null;
      this.#listeningPromise = null;
      throw error;
    }
  }

  #bindSocket(socket: WebSocket): void {
    let bridge: BridgeRecord | undefined;
    const helloTimer = setTimeout(() => {
      socket.close(4401, "tool bridge authentication timed out");
    }, 5_000);
    socket.once("message", (raw) => {
      clearTimeout(helloTimer);
      const hello = parseRecord(raw.toString(), MAX_CALL_BYTES);
      const candidate =
        hello?.type === "hello" && typeof hello.bridgeId === "string"
          ? this.#bridges.get(hello.bridgeId)
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
      socket.on("message", (later) => this.#handleBridgeMessage(bridge!, socket, later.toString()));
    });
    socket.on("close", () => {
      clearTimeout(helloTimer);
      if (!bridge) return;
      bridge.sockets.delete(socket);
      for (const [callId, pendingSocket] of bridge.pending) {
        if (pendingSocket !== socket) continue;
        bridge.pending.delete(callId);
        bridge.sink.sendToolCancel({
          bridgeId: bridge.id,
          bindingId: bridge.bindingId,
          callId,
        });
      }
    });
  }

  #handleBridgeMessage(
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
      if (bridge.pending.delete(message.id)) {
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
    bridge.pending.set(message.id, socket);
    bridge.sink.sendToolCall({
      bridgeId: bridge.id,
      bindingId: bridge.bindingId,
      callId: message.id,
      name: message.name,
      input: message.input,
    });
  }

  #requireOwned(connectionId: string, bridgeId: string): BridgeRecord {
    const bridge = this.#bridges.get(bridgeId);
    if (!bridge || bridge.connectionId !== connectionId) {
      throw new Error("Unknown app tool bridge");
    }
    return bridge;
  }

  #closeRecord(bridge: BridgeRecord): void {
    this.#bridges.delete(bridge.id);
    for (const callId of bridge.pending.keys()) {
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
}

function sanitizeDescriptors(
  descriptors: ToolBridgeDescriptor[],
): ToolBridgeDescriptor[] {
  if (!Array.isArray(descriptors) || descriptors.length > 128) {
    throw new Error("Invalid app tool descriptor snapshot");
  }
  const names = new Set<string>();
  return descriptors
    .map((descriptor) => {
      if (
        !/^[a-z][a-z0-9_]{0,63}$/u.test(descriptor.name) ||
        names.has(descriptor.name) ||
        typeof descriptor.description !== "string" ||
        descriptor.inputSchema?.type !== "object"
      ) {
        throw new Error("Invalid app tool descriptor");
      }
      names.add(descriptor.name);
      return JSON.parse(JSON.stringify(descriptor)) as ToolBridgeDescriptor;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseRecord(raw: string, maxBytes: number): Record<string, unknown> | null {
  if (Buffer.byteLength(raw) > maxBytes) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value));
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
}

function defaultShimPath(): string {
  const directory = path.dirname(process.argv[1] || process.cwd());
  const modulePath = path.join(directory, "mcp-shim.mjs");
  return existsSync(modulePath) ? modulePath : path.join(directory, "mcp-shim.js");
}
