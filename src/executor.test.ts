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
