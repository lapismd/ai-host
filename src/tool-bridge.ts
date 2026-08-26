import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

export type ToolBridgeHttpContribution = {
  type: "http";
  name: "lapis-tools";
  url: string;
  headers: Array<{ name: string; value: string }>;
};

type PendingCall =
  | { kind: "socket"; socket: WebSocket }
  | {
      kind: "local";
      resolve(value: {
        result?: unknown;
        error?: { code: string; message: string };
      }): void;
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
  pending: Map<string, PendingCall>;
};

export type ToolBridgeBrokerOptions = {
  shimPath?: string;
  nodeCommand?: string;
  shimArgsPrefix?: string[];
  extraEnv?: Record<string, string>;
  listenPort?: number;
  externalHttpBaseUrl?: string;
};

export class ToolBridgeBroker {
  readonly #bridges = new Map<string, BridgeRecord>();
  readonly #shimPath: string;
  readonly #nodeCommand: string;
  readonly #shimArgsPrefix: string[];
  readonly #extraEnv: Record<string, string>;
  readonly #listenPort: number;
  readonly #externalHttpBaseUrl: URL | null;
  #http: Server | null = null;
  #wss: WebSocketServer | null = null;
  #listeningPromise: Promise<void> | null = null;
  #port = 0;

  constructor(options: ToolBridgeBrokerOptions = {}) {
    this.#shimPath = options.shimPath ?? resolveDefaultShimPath();
    this.#nodeCommand = options.nodeCommand ?? process.execPath;
    this.#shimArgsPrefix = [...(options.shimArgsPrefix ?? [])];
    this.#extraEnv = { ...(options.extraEnv ?? {}) };
    this.#listenPort = validateListenPort(options.listenPort ?? 0);
    this.#externalHttpBaseUrl = normalizeExternalHttpBaseUrl(
      options.externalHttpBaseUrl,
    );
  }

  async open(
    sink: ToolBridgeSink,
    payload: ToolBridgeOpenPayload,
  ): Promise<{ bridgeId: string }> {
    if (!this.#externalHttpBaseUrl) await this.#ensureListening();
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
    if (this.#externalHttpBaseUrl) {
      throw new Error(
        "External HTTP tool bridges do not expose a WebSocket stdio contribution",
      );
    }
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

  httpServerContribution(
    connectionId: string,
    bridgeId: string,
  ): ToolBridgeHttpContribution {
    const bridge = this.#requireOwned(connectionId, bridgeId);
    const url = this.#externalHttpBaseUrl
      ? new URL(`mcp/${bridge.id}`, this.#externalHttpBaseUrl).href
      : `http://127.0.0.1:${this.#port}/mcp/${bridge.id}`;
    return {
      type: "http",
      name: "lapis-tools",
      url,
      headers: [
        { name: "Authorization", value: `Bearer ${bridge.token}` },
      ],
    };
  }

  async handleWebRequest(request: Request): Promise<Response | undefined> {
    if (!this.#externalHttpBaseUrl) return undefined;
    const requestUrl = new URL(request.url);
    const routePrefix = `${this.#externalHttpBaseUrl.pathname}mcp/`;
    if (!requestUrl.pathname.startsWith(routePrefix)) return undefined;
    const bridgeId = requestUrl.pathname.slice(routePrefix.length);
    if (!bridgeId || bridgeId.includes("/")) return new Response(null, { status: 404 });
    const token = bearerToken(request.headers.get("authorization") ?? undefined);
    const bridge = this.#bridges.get(bridgeId);
    if (!bridge || !token || !tokensEqual(bridge.token, token)) {
      return new Response(null, { status: 401 });
    }
    const server = createLapisMcpServer(bridge.descriptors, (name, input, signal) =>
      this.#invokeLocal(bridge, name, input, signal),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }

  respond(connectionId: string, response: ToolBridgeResponse): void {
    const bridge = this.#requireOwned(connectionId, response.bridgeId);
    const pending = bridge.pending.get(response.callId);
    if (!pending) throw new Error("Unknown or completed app tool call");
    bridge.pending.delete(response.callId);
    if (pending.kind === "local") {
      pending.resolve({
        result: response.result,
        error: response.error,
      });
      return;
    }
    const frame = {
      type: "result",
      id: response.callId,
      result: response.result,
      error: response.error,
    };
    if (jsonBytes(frame) > MAX_RESULT_BYTES) {
      sendJson(pending.socket, {
        type: "result",
        id: response.callId,
        error: { code: "result_too_large", message: "Tool result is too large" },
      });
      return;
    }
    sendJson(pending.socket, frame);
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
    const wss = this.#wss;
    const http = this.#http;
    this.#wss = null;
    this.#http = null;
    this.#listeningPromise = null;
    this.#port = 0;
    if (wss) {
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (http) {
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  async #ensureListening(): Promise<void> {
    if (this.#listeningPromise) return this.#listeningPromise;
    const http = createServer((req, res) => {
      void this.#handleMcpHttp(req, res);
    });
    const wss = new WebSocketServer({ server: http });
    this.#http = http;
    this.#wss = wss;
    wss.on("connection", (socket) => this.#bindSocket(socket));
    this.#listeningPromise = new Promise<void>((resolve, reject) => {
      http.once("listening", () => {
        const address = http.address();
        if (!address || typeof address === "string") {
          reject(new Error("Tool bridge did not bind a loopback port"));
          return;
        }
        this.#port = address.port;
        resolve();
      });
      http.once("error", reject);
    });
    http.listen(this.#listenPort, "127.0.0.1");
    try {
      await this.#listeningPromise;
    } catch (error) {
      this.#http = null;
      this.#wss = null;
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

  #requireOwned(connectionId: string, bridgeId: string): BridgeRecord {
    const bridge = this.#bridges.get(bridgeId);
    if (!bridge || bridge.connectionId !== connectionId) {
      throw new Error("Unknown app tool bridge");
    }
    return bridge;
  }

  async #handleMcpHttp(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const pathname = new URL(req.url ?? "", "http://127.0.0.1").pathname;
    const match = /^\/mcp\/([^/]+)$/u.exec(pathname);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const token = bearerToken(req.headers.authorization);
    const bridge = this.#bridges.get(match[1] ?? "");
    if (!bridge || !token || !tokensEqual(bridge.token, token)) {
      res.writeHead(401).end();
      return;
    }
    const server = createLapisMcpServer(bridge.descriptors, (name, input, signal) =>
      this.#invokeLocal(bridge, name, input, signal),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }

  async #invokeLocal(
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

  #closeRecord(bridge: BridgeRecord): void {
    this.#bridges.delete(bridge.id);
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
}

function validateListenPort(port: number): number {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Tool bridge listen port must be an integer from 0 to 65535");
  }
  return port;
}

function normalizeExternalHttpBaseUrl(value: string | undefined): URL | null {
  if (value === undefined) return null;
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("External tool bridge URL must be an uncredentialed 127.0.0.1 HTTP URL");
  }
  url.pathname = `${url.pathname.replace(/\/*$/u, "")}/`;
  return url;
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

function bearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/iu.exec(value?.trim() ?? "");
  return match?.[1] ?? "";
}

function createLapisMcpServer(
  descriptors: ToolBridgeDescriptor[],
  invoke: (
    name: string,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>,
): McpServer {
  const server = new McpServer(
    { name: "lapis-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: descriptors.map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
      annotations: {
        readOnlyHint: descriptor.effect === "read",
        destructiveHint: descriptor.effect === "write",
        openWorldHint: descriptor.effect === "external",
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    return toMcpToolResult(
      await invoke(
        request.params.name,
        request.params.arguments ?? {},
        extra.signal,
      ),
    ) as never;
  });
  return server;
}

function toMcpToolResult(value: unknown): unknown {
  if (!isRecord(value) || value.structuredContent === undefined) return value;
  if (isRecord(value.structuredContent)) return value;
  return {
    ...value,
    structuredContent: { value: value.structuredContent },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveDefaultShimPath(moduleUrl = import.meta.url): string {
  const directory = path.dirname(fileURLToPath(moduleUrl));
  const packageRoot = ["src", "dist"].includes(path.basename(directory))
    ? path.dirname(directory)
    : directory;
  return path.join(packageRoot, "bin", "lapis-mcp-shim.mjs");
}
