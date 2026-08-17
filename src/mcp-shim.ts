import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";

type Descriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  effect: "read" | "write" | "external";
};

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  removeAbort(): void;
};

class BrokerClient {
  readonly #pending = new Map<string, Pending>();
  #socket: WebSocket | null = null;
  descriptors: Descriptor[] = [];

  async connect(): Promise<void> {
    const url = requiredEnv("LAPIS_TOOL_BRIDGE_URL");
    const bridgeId = requiredEnv("LAPIS_TOOL_BRIDGE_ID");
    const token = requiredEnv("LAPIS_TOOL_BRIDGE_TOKEN");
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.#socket = socket;
      const fail = (error: Error) => {
        socket.close();
        reject(error);
      };
      socket.once("open", () => {
        socket.send(JSON.stringify({ type: "hello", bridgeId, token }));
      });
      socket.once("error", () => fail(new Error("Tool bridge connection failed")));
      socket.once("message", (raw) => {
        const message = parseRecord(raw.toString());
        if (message?.type !== "hello.ok" || !Array.isArray(message.descriptors)) {
          fail(new Error("Tool bridge authentication failed"));
          return;
        }
        this.descriptors = message.descriptors as Descriptor[];
        socket.on("message", (later) => this.#handle(later.toString()));
        socket.on("close", () => this.#rejectAll(new Error("Tool bridge closed")));
        resolve();
      });
    });
  }

  call(name: string, input: unknown, signal: AbortSignal): Promise<unknown> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Tool bridge is not connected"));
    }
    if (signal.aborted) return Promise.reject(new Error("Tool call cancelled"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(id);
        socket.send(JSON.stringify({ type: "cancel", id }));
        reject(new Error("Tool call cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(id, {
        resolve,
        reject,
        removeAbort: () => signal.removeEventListener("abort", onAbort),
      });
      socket.send(JSON.stringify({ type: "call", id, name, input }));
    });
  }

  close(): void {
    this.#rejectAll(new Error("Tool bridge closed"));
    this.#socket?.close(1000, "MCP shim closed");
    this.#socket = null;
  }

  #handle(raw: string): void {
    const message = parseRecord(raw);
    if (message?.type !== "result" || typeof message.id !== "string") return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    pending.removeAbort();
    if (message.error && typeof message.error === "object") {
      pending.resolve({
        content: [
          {
            type: "text",
            text: String((message.error as { message?: unknown }).message ?? "Tool call failed"),
          },
        ],
        isError: true,
      });
      return;
    }
    pending.resolve(message.result);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.removeAbort();
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

async function main(): Promise<void> {
  const broker = new BrokerClient();
  await broker.connect();
  const server = new Server(
    { name: "lapis-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: broker.descriptors.map((descriptor) => ({
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
    return (await broker.call(
      request.params.name,
      request.params.arguments ?? {},
      extra.signal,
    )) as never;
  });
  const shutdown = () => {
    broker.close();
    void server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await server.connect(new StdioServerTransport());
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function parseRecord(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(
    `[lapis-mcp-shim] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
