import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentRuntimeBridge,
  maybeRegisterAgentRuntimeBridge,
  type AgentRuntimeBridge,
} from "./client";
import {
  createAgentRuntimeExecutor,
  type AcpxRuntimeLike,
  type CreateAcpxRuntime,
} from "./executor";
import { serveAgentHost, type RunningAgentHost } from "./serve";

function createFakeAcpx(): CreateAcpxRuntime {
  return async (sink, sessionId, payload, pendingApprovals) => {
    const runtime: AcpxRuntimeLike = {
      async ensureSession(input) {
        return { sessionKey: input.sessionKey, backend: input.agent };
      },
      startTurn(input) {
        const events = (async function* () {
          yield { type: "text_delta", text: `echo:${input.text}` };
          if (payload.metadata?.requireApproval) {
            const requestId = "tool-1";
            sink.sendRuntimeEvent({
              sessionId,
              type: "permission",
              request: { requestId, id: requestId, toolName: "read" },
            });
            await new Promise<void>((resolve) => {
              pendingApprovals.set(`${sessionId}:${requestId}`, () => resolve());
            });
          }
        })();
        return {
          events,
          result: Promise.resolve({ status: "completed", stopReason: "end_turn" }),
        };
      },
      async cancel() {},
      async close() {},
    };
    return runtime;
  };
}

describe("agent-runtime websocket contract", () => {
  let host: RunningAgentHost | undefined;

  afterEach(async () => {
    await host?.close();
    host = undefined;
  });

  async function startHost() {
    const workspace = await mkdtemp(join(tmpdir(), "lapis-ai-host-"));
    host = await serveAgentHost(
      {
        port: 0,
        bind: "127.0.0.1",
        workspace,
        token: "contract-token",
        origins: [],
      },
      {
        executor: createAgentRuntimeExecutor({
          createAcpxRuntime: createFakeAcpx(),
        }),
        print: () => {},
      },
    );
    return host;
  }

  it("runs start, prompt, permission, cancel, and close over the shared protocol", async () => {
    const running = await startHost();
    const bridge = createAgentRuntimeBridge({
      url: running.url,
      token: running.token,
    });
    const events: Array<Record<string, unknown>> = [];
    const stop = bridge.onAgentRuntimeEvent?.((event) => {
      events.push(event);
    });

    const { sessionId } = await bridge.invoke<{ sessionId: string }>(
      "desktop_agent_acp_start",
      {
        agent: "cursor",
        model: { provider: "cursor", model: "composer" },
        thinking: "low",
        metadata: { requireApproval: true },
      },
    );
    expect(sessionId).toBeTruthy();

    await bridge.invoke("desktop_agent_acp_prompt", {
      sessionId,
      text: "hello",
    });

    await expect
      .poll(() => events.some((event) => event.type === "permission"))
      .toBe(true);

    await bridge.invoke("desktop_agent_acp_respond", {
      sessionId,
      requestId: "tool-1",
      decision: "allow_once",
    });
    await bridge.invoke("desktop_agent_acp_cancel", { sessionId });
    await bridge.invoke("desktop_agent_acp_close", { sessionId });

    expect(events.some((event) => event.type === "event")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "event" &&
          (event.event as { text?: string } | undefined)?.text === "echo:hello",
      ),
    ).toBe(true);
    stop?.();
  });

  it("registers a browser bridge only when URL, token, and no existing bridge are set", () => {
    let registered: AgentRuntimeBridge | null = null;
    expect(maybeRegisterAgentRuntimeBridge({})).toBe(false);
    expect(
      maybeRegisterAgentRuntimeBridge({
        url: "ws://127.0.0.1:7345",
        token: "secret",
      }),
    ).toBe(false);

    expect(
      maybeRegisterAgentRuntimeBridge({
        url: "ws://127.0.0.1:7345",
        token: "secret",
        hasBridge: () => registered !== null,
        register: (bridge) => {
          registered = bridge;
        },
      }),
    ).toBe(true);
    expect(registered?.capabilities["agent-runtime"]?.status).toBe("available");

    expect(
      maybeRegisterAgentRuntimeBridge({
        url: "ws://127.0.0.1:9",
        token: "other",
        hasBridge: () => registered !== null,
        register: (bridge) => {
          registered = bridge;
        },
      }),
    ).toBe(false);
  });
});
