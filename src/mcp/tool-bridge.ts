import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import {
  jsonBytes,
  sanitizeDescriptors,
  sendJson,
} from "./tool-bridge-framing";
import {
  handleExternalWebRequest,
  handleLoopbackMcpHttp,
} from "./tool-bridge-http";
import {
  bindToolBridgeSocket,
  closeBridgeRecord,
  invokeLocalTool,
} from "./tool-bridge-session";
import {
  normalizeExternalHttpBaseUrl,
  normalizeShimCommand,
  resolveDefaultShimPath,
  validateListenPort,
} from "./tool-bridge-shim";
import {
  MAX_RESULT_BYTES,
  type BridgeRecord,
  type ToolBridgeBrokerOptions,
  type ToolBridgeHttpContribution,
  type ToolBridgeOpenPayload,
  type ToolBridgeResponse,
  type ToolBridgeServerContribution,
  type ToolBridgeSink,
} from "./tool-bridge-types";

export type {
  ToolBridgeBrokerOptions,
  ToolBridgeCall,
  ToolBridgeCancel,
  ToolBridgeDescriptor,
  ToolBridgeHttpContribution,
  ToolBridgeOpenPayload,
  ToolBridgeResponse,
  ToolBridgeServerContribution,
  ToolBridgeSink,
} from "./tool-bridge-types";
export { resolveDefaultShimPath } from "./tool-bridge-shim";

export class ToolBridgeBroker {
  readonly #bridges = new Map<string, BridgeRecord>();
  readonly #shimCommand: { command: string; args: string[] };
  readonly #extraEnv: Record<string, string>;
  readonly #listenPort: number;
  readonly #externalHttpBaseUrl: URL | null;
  #http: Server | null = null;
  #wss: WebSocketServer | null = null;
  #listeningPromise: Promise<void> | null = null;
  #port = 0;

  constructor(options: ToolBridgeBrokerOptions = {}) {
    this.#shimCommand = options.shimCommand
      ? normalizeShimCommand(options.shimCommand)
      : {
          command: options.nodeCommand ?? process.execPath,
          args: [
            ...(options.shimArgsPrefix ?? []),
            options.shimPath ?? resolveDefaultShimPath(),
          ],
        };
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
      command: this.#shimCommand.command,
      args: [...this.#shimCommand.args],
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
      headers: [{ name: "Authorization", value: `Bearer ${bridge.token}` }],
    };
  }

  async handleWebRequest(request: Request): Promise<Response | undefined> {
    if (!this.#externalHttpBaseUrl) return undefined;
    return handleExternalWebRequest(
      request,
      this.#externalHttpBaseUrl,
      this.#bridges,
      invokeLocalTool,
    );
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
        error: {
          code: "result_too_large",
          message: "Tool result is too large",
        },
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
    closeBridgeRecord(this.#bridges, bridge);
  }

  closeConnection(connectionId: string): void {
    for (const bridge of [...this.#bridges.values()]) {
      if (bridge.connectionId === connectionId) {
        closeBridgeRecord(this.#bridges, bridge);
      }
    }
  }

  async close(): Promise<void> {
    for (const bridge of [...this.#bridges.values()]) {
      closeBridgeRecord(this.#bridges, bridge);
    }
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
      void handleLoopbackMcpHttp(req, res, this.#bridges, invokeLocalTool);
    });
    const wss = new WebSocketServer({ server: http });
    this.#http = http;
    this.#wss = wss;
    wss.on("connection", (socket) =>
      bindToolBridgeSocket(socket, this.#bridges),
    );
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

  #requireOwned(connectionId: string, bridgeId: string): BridgeRecord {
    const bridge = this.#bridges.get(bridgeId);
    if (!bridge || bridge.connectionId !== connectionId) {
      throw new Error("Unknown app tool bridge");
    }
    return bridge;
  }
}
