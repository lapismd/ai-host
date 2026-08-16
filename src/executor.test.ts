import { describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeExecutor,
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
