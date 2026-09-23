import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { HELLO_TIMEOUT_MS } from "../protocol/protocol";
import { RuntimeEventBroker } from "./ws-broker";
import { bindAuthenticatedSocket } from "./ws-handshake";
import type {
  AgentRuntimeServer,
  AgentRuntimeServerOptions,
} from "./ws-types";

export type {
  AgentRuntimeServer,
  AgentRuntimeServerOptions,
} from "./ws-types";

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
    bindAuthenticatedSocket(
      socket,
      options,
      handshakeTimeoutMs,
      broker,
      randomUUID(),
    );
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
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        for (const client of server.clients) {
          client.terminate();
        }
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await options.executor.close();
    },
  };
}

function waitForListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
}
