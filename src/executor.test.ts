import { describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeExecutor,
  toAcpxMcpServers,
  type AcpxRuntimeLike,
  type CreateAcpxRuntime,
} from "./executor";

const sink = {
  sendRuntimeEvent: vi.fn(),
  sendProcessMessage: vi.fn(),
};

function createRuntime(configOptionKeys: string[]) {
  const setConfigOption = vi.fn();
  const runtime: AcpxRuntimeLike = {
    async ensureSession(input) {
      return { sessionKey: input.sessionKey, backend: input.agent };
    },
    startTurn() {
      return {
        events: (async function* () {})(),
        result: Promise.resolve({ status: "completed" }),
      };
    },
    getCapabilities() {
      return { configOptionKeys };
    },
    setConfigOption,
    async cancel() {},
    async close() {},
  };
  return { runtime, setConfigOption };
}

describe("agent runtime executor ACP thinking", () => {
  it("keeps sessions usable when thinking is not advertised", async () => {
    const fake = createRuntime(["mode", "model"]);
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => fake.runtime,
    });

    const result = await executor.startAcpSession(sink, {
      agent: "codex",
      thinking: "medium",
    });

    expect(result.sessionId).toBeTruthy();
    expect(fake.setConfigOption).not.toHaveBeenCalled();
    await executor.closeAcpSession(result.sessionId);
  });

  it("applies thinking when the session advertises effort", async () => {
    const fake = createRuntime(["mode", "model", "effort"]);
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => fake.runtime,
    });

    const result = await executor.startAcpSession(sink, {
      agent: "codex",
      thinking: "high",
    });

    expect(fake.setConfigOption).toHaveBeenCalledWith({
      handle: expect.any(Object),
      key: "thinking",
      value: "high",
    });
    await executor.closeAcpSession(result.sessionId);
  });
});

describe("agent runtime executor ACP model catalogs", () => {
  it("keeps Cursor models when backend session close is unsupported", async () => {
    const fake = createRuntime(["mode", "model"]);
    fake.runtime.getStatus = async () => ({
      models: {
        currentModelId: "composer-2.5",
        availableModelIds: ["composer-2.5", "composer-2.5-fast"],
      },
    });
    const unsupported = Object.assign(
      new Error("Agent does not support session/close"),
      { code: "ACP_BACKEND_UNSUPPORTED_CONTROL" },
    );
    const close = vi
      .fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValueOnce(undefined);
    fake.runtime.close = close;
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => fake.runtime,
    });

    await expect(
      executor.listAcpModels(sink, { agent: "cursor" }),
    ).resolves.toEqual({
      agent: "cursor",
      currentModel: "composer-2.5",
      models: ["composer-2.5", "composer-2.5-fast"],
      entries: [
        { id: "composer-2.5", label: "composer-2.5" },
        { id: "composer-2.5-fast", label: "composer-2.5-fast" },
      ],
    });
    expect(close).toHaveBeenNthCalledWith(1, {
      handle: expect.any(Object),
      reason: "model catalog complete",
      discardPersistentState: true,
    });
    expect(close).toHaveBeenNthCalledWith(2, {
      handle: expect.any(Object),
      reason: "model catalog complete",
    });
  });
});

describe("agent runtime executor sequencing", () => {
  it("reattaches an existing native session without resetting sequence identity", async () => {
    sink.sendRuntimeEvent.mockClear();
    sink.sendProcessMessage.mockClear();
    const fake = createRuntime(["mode", "model"]);
    const createAcpxRuntime = vi.fn(async () => fake.runtime);
    const executor = createAgentRuntimeExecutor({ createAcpxRuntime });
    const first = await executor.startAcpSession(sink, { agent: "codex" });
    const firstRun = await executor.promptAcpSession(
      sink,
      first.sessionId,
      "first",
    );
    await expect.poll(() => sink.sendRuntimeEvent.mock.calls.length).toBe(1);

    await executor.startAcpSession(sink, {
      agent: "codex",
      resumeSessionId: first.sessionId,
    });
    const secondRun = await executor.promptAcpSession(
      sink,
      first.sessionId,
      "second",
    );
    await expect.poll(() => sink.sendRuntimeEvent.mock.calls.length).toBe(2);

    expect(createAcpxRuntime).toHaveBeenCalledTimes(1);
    expect(firstRun.runId).not.toBe(secondRun.runId);
    expect(
      sink.sendRuntimeEvent.mock.calls.map(([event]) => event.sequence),
    ).toEqual([1, 2]);
    await executor.closeAcpSession(first.sessionId);
    sink.sendRuntimeEvent.mockClear();
  });

  it("resumes a host session key without treating it as ACP session/load", async () => {
    const ensureSession = vi.fn(async (input: { sessionKey: string }) => ({
      sessionKey: input.sessionKey,
      backend: "codex",
    }));
    const runtime: AcpxRuntimeLike = {
      ensureSession,
      startTurn() {
        return {
          events: (async function* () {})(),
          result: Promise.resolve({ status: "completed" }),
        };
      },
      async cancel() {},
      async close() {},
    };
    const first = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => runtime,
    });
    const started = await first.startAcpSession(sink, { agent: "codex" });
    await first.closeAcpSession(started.sessionId);

    const restarted = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => runtime,
    });
    const resumed = await restarted.startAcpSession(sink, {
      agent: "codex",
      resumeSessionId: started.sessionId,
    });

    expect(resumed.sessionId).toBe(started.sessionId);
    expect(ensureSession).toHaveBeenCalledTimes(2);
    expect(ensureSession.mock.calls[0]?.[0]).toMatchObject({
      sessionKey: started.sessionId,
    });
    expect(ensureSession.mock.calls[0]?.[0]).not.toHaveProperty(
      "resumeSessionId",
    );
    expect(ensureSession.mock.calls[1]?.[0]).toMatchObject({
      sessionKey: started.sessionId,
    });
    expect(ensureSession.mock.calls[1]?.[0]).not.toHaveProperty(
      "resumeSessionId",
    );
    await restarted.closeAcpSession(resumed.sessionId);
  });
});

describe("agent runtime executor deferred ACP startup", () => {
  it("reserves a caller-selected session id and queues its prompt", async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    const startTurn = vi.fn(() => ({
      events: (async function* () {})(),
      result: Promise.resolve({ status: "completed" as const }),
    }));
    const fake = createRuntime([]);
    fake.runtime.ensureSession = async (input) => {
      await startup;
      return { sessionKey: input.sessionKey, backend: input.agent };
    };
    fake.runtime.startTurn = startTurn;
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => fake.runtime,
    });

    expect(
      executor.startAcpSessionDeferred(sink, {
        sessionId: "reserved-session",
        agent: "cursor",
      }),
    ).toEqual({ sessionId: "reserved-session" });
    const prompted = await executor.promptAcpSession(
      sink,
      "reserved-session",
      "hello",
    );
    expect(prompted.runId).toBeTruthy();
    expect(startTurn).not.toHaveBeenCalled();

    finishStartup();
    await expect.poll(() => startTurn.mock.calls.length).toBe(1);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello",
        requestId: prompted.runId,
      }),
    );
    await executor.closeAcpSession("reserved-session");
  });

  it("cancels a prompt queued during startup without discarding the session", async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>((resolve) => {
      finishStartup = resolve;
    });
    const startTurn = vi.fn(() => ({
      events: (async function* () {})(),
      result: Promise.resolve({ status: "completed" as const }),
    }));
    const fake = createRuntime([]);
    fake.runtime.ensureSession = async (input) => {
      await startup;
      return { sessionKey: input.sessionKey, backend: input.agent };
    };
    fake.runtime.startTurn = startTurn;
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => fake.runtime,
    });

    executor.startAcpSessionDeferred(sink, {
      sessionId: "cancelled-pending-session",
      agent: "codex",
    });
    await executor.promptAcpSession(
      sink,
      "cancelled-pending-session",
      "cancel me",
    );
    await executor.cancelAcpSession("cancelled-pending-session");
    finishStartup();
    await executor.startAcpSession(sink, {
      sessionId: "cancelled-pending-session",
      agent: "codex",
    });
    expect(startTurn).not.toHaveBeenCalled();

    await executor.promptAcpSession(
      sink,
      "cancelled-pending-session",
      "next turn",
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ text: "next turn" }),
    );
    await executor.closeAcpSession("cancelled-pending-session");
  });

  it("emits one sequenced error when deferred startup fails", async () => {
    const eventSink = {
      sendRuntimeEvent: vi.fn(),
      sendProcessMessage: vi.fn(),
    };
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => {
        throw new Error("startup broke");
      },
    });

    executor.startAcpSessionDeferred(eventSink, {
      sessionId: "failed-session",
      agent: "cursor",
    });
    const prompted = await executor.promptAcpSession(
      eventSink,
      "failed-session",
      "hello",
    );

    await expect
      .poll(() => eventSink.sendRuntimeEvent.mock.calls.length)
      .toBe(1);
    expect(eventSink.sendRuntimeEvent).toHaveBeenCalledWith({
      sessionId: "failed-session",
      runId: prompted.runId,
      sequence: 1,
      event: {
        type: "event",
        event: { type: "error", message: "startup broke" },
        request: undefined,
      },
    });
  });

  it("rejects conflicting caller and resume session ids", () => {
    const executor = createAgentRuntimeExecutor();
    expect(() =>
      executor.startAcpSessionDeferred(sink, {
        sessionId: "new-session",
        resumeSessionId: "stored-session",
      }),
    ).toThrow("must match resumeSessionId");
  });
});

describe("agent runtime MCP projection", () => {
  it("converts environment records to ACP name/value entries", () => {
    expect(
      toAcpxMcpServers([
        {
          name: "example",
          command: "example-mcp",
          env: { ALPHA: "one", BETA: "two" },
        },
      ]),
    ).toEqual([
      {
        type: "stdio",
        name: "example",
        command: "example-mcp",
        args: [],
        env: [
          { name: "ALPHA", value: "one" },
          { name: "BETA", value: "two" },
        ],
      },
    ]);
  });

  it("preserves HTTP MCP servers for agents that skip stdio", () => {
    expect(
      toAcpxMcpServers([
        {
          type: "http",
          name: "lapis-tools",
          url: "http://127.0.0.1:9/mcp/bridge",
          headers: [{ name: "Authorization", value: "Bearer secret" }],
        },
      ]),
    ).toEqual([
      {
        type: "http",
        name: "lapis-tools",
        url: "http://127.0.0.1:9/mcp/bridge",
        headers: [{ name: "Authorization", value: "Bearer secret" }],
      },
    ]);
  });

  it("projects Cursor lapis-tools as Streamable HTTP MCP", async () => {
    let projected: Parameters<CreateAcpxRuntime>[2]["mcpServers"];
    const fake = createRuntime(["mode", "model"]);
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async (_sink, _sessionId, payload) => {
        projected = payload.mcpServers;
        return fake.runtime;
      },
    });
    const toolSink = {
      connectionId: "renderer-1",
      sendRuntimeEvent: vi.fn(),
      sendProcessMessage: vi.fn(),
      sendToolCall: vi.fn(),
      sendToolCancel: vi.fn(),
    };
    const opened = await executor.openToolBridge(toolSink, {
      bindingId: "binding-1",
      conversationId: "conversation-1",
      descriptors: [
        {
          name: "notes_search",
          description: "Search notes",
          inputSchema: { type: "object" },
          effect: "read",
        },
      ],
    });
    await executor.startAcpSession(toolSink, {
      agent: "cursor",
      appToolBridgeId: opened.bridgeId,
    });
    expect(projected).toEqual([
      expect.objectContaining({
        type: "http",
        name: "lapis-tools",
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp\//u),
        headers: [
          expect.objectContaining({
            name: "Authorization",
            value: expect.stringMatching(/^Bearer /u),
          }),
        ],
      }),
    ]);
    await executor.close();
  });

  it("keeps stdio lapis-tools for Codex ACP", async () => {
    let projected: Parameters<CreateAcpxRuntime>[2]["mcpServers"];
    const fake = createRuntime(["mode", "model"]);
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async (_sink, _sessionId, payload) => {
        projected = payload.mcpServers;
        return fake.runtime;
      },
    });
    const toolSink = {
      connectionId: "renderer-1",
      sendRuntimeEvent: vi.fn(),
      sendProcessMessage: vi.fn(),
      sendToolCall: vi.fn(),
      sendToolCancel: vi.fn(),
    };
    const opened = await executor.openToolBridge(toolSink, {
      bindingId: "binding-1",
      conversationId: "conversation-1",
      descriptors: [
        {
          name: "notes_search",
          description: "Search notes",
          inputSchema: { type: "object" },
          effect: "read",
        },
      ],
    });
    await executor.startAcpSession(toolSink, {
      agent: "codex",
      appToolBridgeId: opened.bridgeId,
    });
    expect(projected).toEqual([
      expect.objectContaining({
        name: "lapis-tools",
        command: expect.any(String),
        args: expect.any(Array),
        env: expect.objectContaining({
          LAPIS_TOOL_BRIDGE_URL: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:/u),
        }),
      }),
    ]);
    expect(projected?.[0]).not.toHaveProperty("type", "http");
    await executor.close();
  });

  it("rejects the reserved lapis-tools server name", async () => {
    const executor = createAgentRuntimeExecutor({
      createAcpxRuntime: async () => {
        throw new Error("runtime must not start");
      },
    });

    await expect(
      executor.startAcpSession(sink, {
        agent: "codex",
        mcpServers: [{ name: "lapis-tools", command: "forged" }],
      }),
    ).rejects.toThrow("MCP server name is reserved: lapis-tools");
    await executor.close();
  });
});
