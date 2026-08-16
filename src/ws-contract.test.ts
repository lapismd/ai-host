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
              pendingApprovals.set(`${sessionId}:${requestId}`, () =>
                resolve(),
              );
            });
          }
        })();
        return {
          events,
          result: Promise.resolve({
            status: "completed",
            stopReason: "end_turn",
          }),
        };
      },
      async getStatus() {
        return {
          models: {
            currentModelId:
              payload.agent === "cursor" ? "composer" : "gpt-test",
            availableModelIds:
              payload.agent === "cursor"
                ? ["composer", "composer-fast"]
                : ["gpt-test"],
          },
        };
      },
      async setConfigOption() {},
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

  async function startHost(createAcpxRuntime = createFakeAcpx()) {
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
          createAcpxRuntime,
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

    await expect(
      bridge.invoke("desktop_agent_acp_models", { agent: "cursor" }),
    ).resolves.toMatchObject({
      agent: "cursor",
      currentModel: "composer",
      models: ["composer", "composer-fast"],
    });

    const prompted = await bridge.invoke<{ runId: string }>(
      "desktop_agent_acp_prompt",
      {
        sessionId,
        text: "hello",
      },
    );
    expect(prompted.runId).toBeTruthy();

    await expect
      .poll(() =>
        events.some(
          (event) =>
            (event.event as { type?: string } | undefined)?.type ===
            "permission",
        ),
      )
      .toBe(true);

    await bridge.invoke("desktop_agent_acp_respond", {
      sessionId,
      requestId: "tool-1",
      decision: "allow_once",
    });
    await bridge.invoke("desktop_agent_acp_cancel", { sessionId });
    await bridge.invoke("desktop_agent_acp_close", { sessionId });

    expect(
      events.some(
        (event) =>
          (event.event as { type?: string } | undefined)?.type === "event",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          (event.event as { event?: { text?: string } } | undefined)?.event
            ?.text === "echo:hello",
      ),
    ).toBe(true);
    expect(events.every((event) => event.runId === prompted.runId)).toBe(true);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    stop?.();
  });

  it("reconnects and replays events once without resending the prompt", async () => {
    let releaseSecond!: () => void;
    const waitForSecond = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let turns = 0;
    const running = await startHost(
      async (sink, sessionId, _payload, pending) => ({
        async ensureSession(input) {
          return { sessionKey: input.sessionKey };
        },
        startTurn() {
          turns += 1;
          return {
            events: (async function* () {
              yield { type: "text_delta", text: "first" };
              await waitForSecond;
              sink.sendRuntimeEvent({
                sessionId,
                type: "permission",
                request: { requestId: "replayed-approval", toolName: "shell" },
              });
              await new Promise<void>((resolve) => {
                pending.set(`${sessionId}:replayed-approval`, () => resolve());
              });
              yield { type: "text_delta", text: "second" };
            })(),
            result: Promise.resolve({ status: "completed" }),
          };
        },
        async cancel() {},
        async close() {},
      }),
    );
    const bridge = createAgentRuntimeBridge({
      url: running.url,
      token: running.token,
    });
    const events: Array<Record<string, unknown>> = [];
    bridge.onAgentRuntimeEvent?.((event) => events.push(event));
    const { sessionId } = await bridge.invoke<{ sessionId: string }>(
      "desktop_agent_acp_start",
      { agent: "codex" },
    );
    await bridge.invoke("desktop_agent_acp_prompt", {
      sessionId,
      text: "one prompt",
    });
    await expect.poll(() => eventTexts(events).includes("first")).toBe(true);

    running.disconnectClients();
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseSecond();

    await expect
      .poll(
        () =>
          events.filter(
            (event) =>
              (event.event as { type?: string } | undefined)?.type ===
              "permission",
          ).length,
        { timeout: 3_000 },
      )
      .toBe(1);
    await bridge.invoke("desktop_agent_acp_respond", {
      sessionId,
      requestId: "replayed-approval",
      decision: "allow_once",
    });

    await expect
      .poll(() => eventTexts(events).includes("second"), { timeout: 3_000 })
      .toBe(true);
    expect(eventTexts(events).filter((text) => text === "first")).toHaveLength(
      1,
    );
    expect(eventTexts(events).filter((text) => text === "second")).toHaveLength(
      1,
    );
    expect(turns).toBe(1);
    await bridge.invoke("desktop_agent_acp_close", { sessionId });
    bridge.dispose();
  });

  it("surfaces host restart as an interrupted turn without replaying input", async () => {
    let turns = 0;
    const createRuntime: CreateAcpxRuntime = async () => ({
      async ensureSession(input) {
        return { sessionKey: input.sessionKey };
      },
      startTurn() {
        turns += 1;
        return {
          events: (async function* () {
            yield { type: "text_delta", text: "before restart" };
          })(),
          result: Promise.resolve({ status: "completed" }),
        };
      },
      async cancel() {},
      async close() {},
    });
    const running = await startHost(createRuntime);
    const port = Number(new URL(running.url).port);
    const bridge = createAgentRuntimeBridge({
      url: running.url,
      token: running.token,
    });
    const events: Array<Record<string, unknown>> = [];
    bridge.onAgentRuntimeEvent?.((event) => events.push(event));
    const { sessionId } = await bridge.invoke<{ sessionId: string }>(
      "desktop_agent_acp_start",
      { agent: "codex" },
    );
    await bridge.invoke("desktop_agent_acp_prompt", {
      sessionId,
      text: "must run once",
    });
    await expect
      .poll(() => eventTexts(events).includes("before restart"))
      .toBe(true);

    await running.close();
    host = await serveAgentHost(
      {
        port,
        bind: "127.0.0.1",
        workspace: running.workspace,
        token: running.token,
        origins: [],
      },
      {
        executor: createAgentRuntimeExecutor({
          createAcpxRuntime: createRuntime,
        }),
        print: () => {},
      },
    );

    await expect
      .poll(
        () =>
          events.some(
            (event) =>
              (event.event as { event?: { code?: string } } | undefined)?.event
                ?.code === "AGENT_RUNTIME_REPLAY_GAP",
          ),
        { timeout: 3_000 },
      )
      .toBe(true);
    expect(turns).toBe(1);
    bridge.dispose();
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

function eventTexts(events: Array<Record<string, unknown>>): string[] {
  return events.flatMap((event): string[] => {
    const payload = event.event as
      | { event?: { type?: string; text?: string } }
      | undefined;
    return payload?.event?.type === "text_delta" && payload.event.text
      ? [payload.event.text]
      : [];
  });
}
