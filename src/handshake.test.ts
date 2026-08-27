import { afterEach, describe, expect, it } from "vitest";
import { createAgentRuntimeExecutor } from "./executor";
import { AUTH_CLOSE_CODE } from "./protocol";
import { startAgentRuntimeServer, type AgentRuntimeServer } from "./ws-server";

const TOKEN = "test-token-value";

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket error")), {
      once: true,
    });
  });
  return socket;
}

function waitForClose(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    );
  });
}

describe("agent-runtime websocket handshake", () => {
  let server: AgentRuntimeServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function listen() {
    server = await startAgentRuntimeServer({
      port: 0,
      bind: "127.0.0.1",
      token: TOKEN,
      workspace: "/tmp/ai-host-test",
      executor: createAgentRuntimeExecutor({
        createAcpxRuntime: async () => {
          throw new Error("acpx should not run before handshake");
        },
      }),
    });
    return `ws://127.0.0.1:${server.port}`;
  }

  it("closes a socket whose first frame is not hello", async () => {
    const url = await listen();
    const socket = await openSocket(url);
    const closed = waitForClose(socket);
    socket.send(
      JSON.stringify({
        id: "1",
        command: "desktop_agent_acp_start",
        payload: {},
      }),
    );
    const result = await closed;
    expect(result.code).toBe(AUTH_CLOSE_CODE);
  });

  it("closes a socket that sends a bad token", async () => {
    const url = await listen();
    const socket = await openSocket(url);
    const closed = waitForClose(socket);
    socket.send(JSON.stringify({ id: "1", type: "hello", token: "nope" }));
    const result = await closed;
    expect(result.code).toBe(AUTH_CLOSE_CODE);
  });

  it("accepts a hello with the configured token", async () => {
    const url = await listen();
    const socket = await openSocket(url);
    const reply = new Promise<Record<string, unknown>>((resolve) => {
      socket.addEventListener(
        "message",
        (event) => resolve(JSON.parse(String(event.data))),
        { once: true },
      );
    });
    socket.send(JSON.stringify({ id: "hello-1", type: "hello", token: TOKEN }));
    await expect(reply).resolves.toMatchObject({
      id: "hello-1",
      type: "hello.ok",
      protocol: 4,
    });
    socket.close();
  });
});
