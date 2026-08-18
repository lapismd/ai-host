import { describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeExecutor,
  toAcpxMcpServers,
  type AcpxRuntimeLike,
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
